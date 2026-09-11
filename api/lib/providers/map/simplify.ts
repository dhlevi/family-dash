/**
 * Throwing away detail nobody can see.
 *
 * Vector tiles are drawn at 4096 units across whatever size they are shown
 * at, so a tile scaled to 600 output pixels carries roughly seven times more
 * geometry than the picture can resolve. Left in, that is most of the weight
 * of the finished SVG, and every one of those points is a number librsvg has
 * to parse and a curve the Raspberry Pi has to flatten.
 *
 * Simplifying after projection rather than before is deliberate: the tolerance
 * is then a distance in output pixels, which is the only unit in which
 * "invisible" actually means anything.
 */

/** Squared perpendicular distance from a point to the segment `a`-`b`. */
function segmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  let dx = bx - ax
  let dy = by - ay

  if (dx !== 0 || dy !== 0) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)

    if (t > 1) {
      ax = bx
      ay = by
    } else if (t > 0) {
      ax += dx * t
      ay += dy * t
    }
  }

  dx = px - ax
  dy = py - ay

  return dx * dx + dy * dy
}

/**
 * Drops points closer together than `tolerance`, in one linear pass.
 *
 * Cheap, and it does most of the work: tile geometry is quantised to a 4096
 * grid that is several times finer than the output, so a great many points are
 * already within a tolerance of their predecessor. Running this first also
 * keeps the input to Douglas-Peucker small, which matters because that part is
 * quadratic in the worst case.
 */
function dropCloserThan(coordinates: number[], tolerance: number): number[] {
  const toleranceSquared = tolerance * tolerance
  const result: number[] = [coordinates[0]!, coordinates[1]!]

  let lastX = coordinates[0]!
  let lastY = coordinates[1]!

  for (let index = 2; index < coordinates.length - 2; index += 2) {
    const x = coordinates[index]!
    const y = coordinates[index + 1]!
    const dx = x - lastX
    const dy = y - lastY

    if (dx * dx + dy * dy > toleranceSquared) {
      result.push(x, y)
      lastX = x
      lastY = y
    }
  }

  // The final point is kept regardless, so that a line keeps its length and a
  // ring still closes where it started.
  result.push(coordinates[coordinates.length - 2]!, coordinates[coordinates.length - 1]!)

  return result
}

/**
 * Beyond this many points, Douglas-Peucker is skipped.
 */
const MAX_DOUGLAS_PEUCKER_POINTS = 12_000

/**
 * Ramer-Douglas-Peucker over a flat `[x0, y0, x1, y1, ...]` array, after a
 * linear pass to thin out points that are already too close to matter.
 *
 * Iterative rather than recursive: a coastline ring out of a single tile can
 * run to thousands of points, and the recursive form is a stack overflow
 * waiting for the one city that has a complicated enough shoreline.
 */
export function simplify(input: number[], tolerance: number): number[] {
  if (input.length / 2 < 3) return input

  const coordinates = dropCloserThan(input, tolerance)
  const pointCount = coordinates.length / 2

  if (pointCount < 3) return coordinates
  if (pointCount > MAX_DOUGLAS_PEUCKER_POINTS) return coordinates

  const toleranceSquared = tolerance * tolerance
  const keep = new Uint8Array(pointCount)
  keep[0] = 1
  keep[pointCount - 1] = 1

  const stack: number[] = [0, pointCount - 1]

  while (stack.length > 0) {
    const last = stack.pop()!
    const first = stack.pop()!
    if (last - first < 2) continue

    let furthest = -1
    let furthestDistance = toleranceSquared

    const ax = coordinates[first * 2]!
    const ay = coordinates[first * 2 + 1]!
    const bx = coordinates[last * 2]!
    const by = coordinates[last * 2 + 1]!

    for (let index = first + 1; index < last; index++) {
      const distance = segmentDistanceSquared(coordinates[index * 2]!, coordinates[index * 2 + 1]!, ax, ay, bx, by)

      if (distance > furthestDistance) {
        furthest = index
        furthestDistance = distance
      }
    }

    if (furthest === -1) continue

    keep[furthest] = 1
    stack.push(first, furthest, furthest, last)
  }

  const result: number[] = []
  for (let index = 0; index < pointCount; index++) {
    if (keep[index] === 1) result.push(coordinates[index * 2]!, coordinates[index * 2 + 1]!)
  }

  return result
}

/**
 * Twice the signed area of a ring, by the shoelace formula.
 *
 * Used only for its magnitude, to drop shapes too small to see. The sign
 * carries ring winding, which the renderer does not need: it fills with the
 * even-odd rule, so holes work regardless of direction.
 */
export function ringArea(coordinates: number[]): number {
  let sum = 0

  for (let index = 0, count = coordinates.length; index < count; index += 2) {
    const nextIndex = (index + 2) % count
    sum += coordinates[index]! * coordinates[nextIndex + 1]! - coordinates[nextIndex]! * coordinates[index + 1]!
  }

  return Math.abs(sum) / 2
}

/** Length of an open line, for dropping stubs shorter than a stroke is wide. */
export function lineLength(coordinates: number[]): number {
  let total = 0

  for (let index = 2; index < coordinates.length; index += 2) {
    const dx = coordinates[index]! - coordinates[index - 2]!
    const dy = coordinates[index + 1]! - coordinates[index - 1]!
    total += Math.hypot(dx, dy)
  }

  return total
}
