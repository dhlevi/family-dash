import type { InkPoint, InkStroke } from '@/api/types'

/**
 * Turning pointer input into handwriting that looks like handwriting.
 *
 * Two things do most of the work here. Raw pointer samples are far denser
 * than a stroke needs — a slow, deliberate line can produce hundreds of
 * points a second — so they are thinned before storage. And a polyline
 * through those samples reads as visibly angular at the scale a sticky note
 * is drawn at, so strokes are rendered as a smooth spline instead.
 */

/** Below this, two samples are the same point as far as a stroke is concerned. */
export const CAPTURE_MIN_DISTANCE = 1.5

/** Simplification tolerance applied when a stroke is finished, in px. */
export const SIMPLIFY_EPSILON = 0.7

export function distance(a: InkPoint, b: InkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Whether a freshly sampled point is far enough from the last kept one to be
 * worth recording. Applied live during capture, which keeps the point count
 * (and so the payload) proportional to the length of the stroke rather than
 * to how long the pen was moving.
 */
export function shouldKeep(
  previous: InkPoint | undefined,
  next: InkPoint,
  minDistance = CAPTURE_MIN_DISTANCE
): boolean {
  return previous === undefined || distance(previous, next) >= minDistance
}

/**
 * Ramer–Douglas–Peucker simplification.
 *
 * Drops points that lie close to the line between their neighbours, which
 * removes the sampling noise along a straight pen movement while leaving
 * every corner and curve intact. Pressure is carried over from the points
 * that survive.
 */
export function simplify(points: InkPoint[], epsilon = SIMPLIFY_EPSILON): InkPoint[] {
  if (points.length <= 2 || epsilon <= 0) return [...points]

  const first = points[0]!
  const last = points[points.length - 1]!

  let furthestIndex = 0
  let furthestDistance = 0

  for (let index = 1; index < points.length - 1; index++) {
    const gap = perpendicularDistance(points[index]!, first, last)
    if (gap > furthestDistance) {
      furthestDistance = gap
      furthestIndex = index
    }
  }

  if (furthestDistance <= epsilon) return [first, last]

  // Recurse either side of the point that deviates most, then join, dropping
  // the duplicated hinge point.
  const left = simplify(points.slice(0, furthestIndex + 1), epsilon)
  const right = simplify(points.slice(furthestIndex), epsilon)

  return [...left.slice(0, -1), ...right]
}

/**
 * Shortest distance from a point to a line *segment* — clamped to the
 * segment's ends rather than measured against the infinite line, which is
 * what both the simplifier and the eraser actually need.
 */
export function distanceToSegment(point: InkPoint, lineStart: InkPoint, lineEnd: InkPoint): number {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y

  // A degenerate segment (the pen came back to where it started) has no
  // direction to measure against, so fall back to straight-line distance.
  if (dx === 0 && dy === 0) return distance(point, lineStart)

  const lengthSquared = dx * dx + dy * dy
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared
  const clamped = Math.max(0, Math.min(1, t))

  return Math.hypot(point.x - (lineStart.x + clamped * dx), point.y - (lineStart.y + clamped * dy))
}

const perpendicularDistance = distanceToSegment

/**
 * How sharp a direction change counts as a corner rather than a curve.
 *
 * Cosine of the angle between the incoming and outgoing directions: 0.5 is
 * 60°. Anything sharper keeps its crease instead of being rounded off.
 */
const CORNER_COSINE = 0.5

/**
 * Whether the turn at `points[index]` is sharp enough to preserve.
 *
 * Without this, a deliberate corner gets smoothed away: a hand-drawn
 * rectangle comes out as a rounded blob and the peak of a roof becomes an
 * arc, because a Catmull-Rom spline has no notion of intent. Handwriting
 * benefits too — the corner of a capital L should be a corner.
 */
function isCorner(points: InkPoint[], index: number): boolean {
  const previous = points[index - 1]
  const current = points[index]
  const next = points[index + 1]

  if (!previous || !current || !next) return false

  const inX = current.x - previous.x
  const inY = current.y - previous.y
  const outX = next.x - current.x
  const outY = next.y - current.y

  const inLength = Math.hypot(inX, inY)
  const outLength = Math.hypot(outX, outY)

  // A doubled-up point has no direction to compare.
  if (inLength === 0 || outLength === 0) return false

  const cosine = (inX * outX + inY * outY) / (inLength * outLength)

  return cosine < CORNER_COSINE
}

/**
 * An SVG path for a stroke, smoothed with a Catmull-Rom spline expressed as
 * cubic Béziers.
 *
 * The spline passes through every recorded point — unlike a plain quadratic
 * smoothing, which pulls the line away from the samples and makes small
 * letters look mushy. Points where the pen changed direction sharply are
 * treated as corners and keep their crease, so smoothing improves a curve
 * without flattening a deliberate angle.
 */
export function toSmoothPath(points: InkPoint[]): string {
  if (points.length === 0) return ''

  const first = points[0]!

  // A single sample is a dot. Rendered as a zero-length line, which a round
  // linecap turns into a circle — so tapping the pen leaves a mark.
  if (points.length === 1) return `M ${round(first.x)} ${round(first.y)} l 0 0`

  if (points.length === 2) {
    const second = points[1]!
    return `M ${round(first.x)} ${round(first.y)} L ${round(second.x)} ${round(second.y)}`
  }

  let path = `M ${round(first.x)} ${round(first.y)}`

  for (let index = 0; index < points.length - 1; index++) {
    // The two points either side of the segment shape its curvature; at the
    // ends the segment's own endpoint stands in for the missing neighbour.
    const previous = points[index - 1] ?? points[index]!
    const current = points[index]!
    const next = points[index + 1]!
    const after = points[index + 2] ?? next

    // Catmull-Rom to Bézier: the classic 1/6 tangent scaling. At a corner the
    // tangent is taken along this segment instead of across the neighbouring
    // points, which straightens the approach and leaves the crease intact.
    const startIsCorner = isCorner(points, index)
    const endIsCorner = isCorner(points, index + 1)

    const control1 = startIsCorner
      ? { x: current.x + (next.x - current.x) / 6, y: current.y + (next.y - current.y) / 6 }
      : { x: current.x + (next.x - previous.x) / 6, y: current.y + (next.y - previous.y) / 6 }

    const control2 = endIsCorner
      ? { x: next.x - (next.x - current.x) / 6, y: next.y - (next.y - current.y) / 6 }
      : { x: next.x - (after.x - current.x) / 6, y: next.y - (after.y - current.y) / 6 }

    path +=
      ` C ${round(control1.x)} ${round(control1.y)},` +
      ` ${round(control2.x)} ${round(control2.y)},` +
      ` ${round(next.x)} ${round(next.y)}`
  }

  return path
}

/** Two decimals is well under a pixel and keeps the stored payload small. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Default eraser radius, in capture-space pixels. */
export const ERASER_RADIUS = 14

/**
 * Whether an eraser path passes close enough to a stroke to remove it.
 *
 * Strokes are erased whole rather than cut into pieces. Splitting a vector
 * stroke where an eraser crosses it is possible but the result is rarely
 * what somebody wanted — on a shared family drawing, "get rid of that line"
 * is the actual intent, and a stroke that survives as two stubs reads as a
 * bug.
 *
 * The eraser's own points are tested against the stroke's *segments*, not
 * its points: a simplified stroke can have metres of straight line between
 * two recorded points, and comparing point-to-point would erase nothing
 * when swiping across the middle of one.
 */
export function strokeHitBy(stroke: InkStroke, eraserPoints: InkPoint[], radius = ERASER_RADIUS): boolean {
  if (stroke.points.length === 0 || eraserPoints.length === 0) return false

  // A thick stroke should be catchable anywhere along its width.
  const reach = radius + stroke.width / 2

  for (const eraserPoint of eraserPoints) {
    // A single-point stroke is a dot, with no segment to measure against.
    if (stroke.points.length === 1) {
      if (distance(eraserPoint, stroke.points[0]!) <= reach) return true
      continue
    }

    for (let index = 0; index < stroke.points.length - 1; index++) {
      if (distanceToSegment(eraserPoint, stroke.points[index]!, stroke.points[index + 1]!) <= reach) {
        return true
      }
    }
  }

  return false
}

/**
 * The strokes that survive an eraser pass, and those it removed.
 *
 * Returning both lets the caller push the removed ones onto an undo stack,
 * so an over-enthusiastic swipe is recoverable.
 */
export function eraseStrokes(
  strokes: InkStroke[],
  eraserPoints: InkPoint[],
  radius = ERASER_RADIUS
): { kept: InkStroke[]; removed: InkStroke[] } {
  const kept: InkStroke[] = []
  const removed: InkStroke[] = []

  for (const stroke of strokes) {
    if (strokeHitBy(stroke, eraserPoints, radius)) removed.push(stroke)
    else kept.push(stroke)
  }

  return { kept, removed }
}

/**
 * A comparable fingerprint of a set of strokes.
 *
 * `JSON.stringify` cannot be used directly for this: strokes make a round
 * trip through a Postgres `jsonb` column, which normalises object key order,
 * so a saved drawing comes back with its keys rearranged and never matches
 * the copy on the canvas. Building the signature from arrays puts the order
 * under our control, so "has this changed since it was saved?" answers
 * honestly.
 */
export function inkSignature(strokes: InkStroke[]): string {
  return JSON.stringify(
    strokes.map(stroke => [stroke.colour, stroke.width, stroke.points.map(point => [point.x, point.y, point.p])])
  )
}

export function totalPoints(strokes: InkStroke[]): number {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0)
}

/**
 * The bounding box of some strokes, or null if there is nothing drawn.
 * Used to fit handwriting into a smaller frame, such as a dashboard widget.
 */
export function strokeBounds(strokes: InkStroke[]): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (point.x < minX) minX = point.x
      if (point.y < minY) minY = point.y
      if (point.x > maxX) maxX = point.x
      if (point.y > maxY) maxY = point.y
    }
  }

  if (minX === Infinity) return null

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * A viewBox that frames the writing with a little breathing room, so a note
 * shrunk into a widget shows the words rather than the empty paper around
 * them. Falls back to the full capture surface when nothing is drawn.
 */
export function fittedViewBox(strokes: InkStroke[], surfaceWidth: number, surfaceHeight: number): string {
  const bounds = strokeBounds(strokes)
  if (!bounds) return `0 0 ${surfaceWidth} ${surfaceHeight}`

  // Pad by the widest stroke so a thick line is not clipped at the edge.
  const widest = strokes.reduce((max, stroke) => Math.max(max, stroke.width), 0)
  const padding = Math.max(widest, Math.min(surfaceWidth, surfaceHeight) * 0.04)

  const x = bounds.x - padding
  const y = bounds.y - padding
  const width = Math.max(bounds.width + padding * 2, 1)
  const height = Math.max(bounds.height + padding * 2, 1)

  return `${round(x)} ${round(y)} ${round(width)} ${round(height)}`
}
