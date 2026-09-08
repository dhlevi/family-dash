import { describe, expect, it } from 'vitest'
import {
  distance,
  distanceToSegment,
  eraseStrokes,
  fittedViewBox,
  inkSignature,
  shouldKeep,
  simplify,
  strokeBounds,
  strokeHitBy,
  toSmoothPath,
  totalPoints
} from './ink'
import type { InkPoint, InkStroke } from '@/api/types'

const point = (x: number, y: number, p = 0.5): InkPoint => ({ x, y, p })

const stroke = (points: InkPoint[], width = 3, colour = '#1a1f2b'): InkStroke => ({ colour, width, points })

describe('shouldKeep', () => {
  it('always keeps the first sample of a stroke', () => {
    expect(shouldKeep(undefined, point(10, 10))).toBe(true)
  })

  it('drops samples that have barely moved', () => {
    // A stylus reports at a high rate; without this a slow line becomes
    // thousands of near-identical points.
    expect(shouldKeep(point(10, 10), point(10.4, 10.2))).toBe(false)
  })

  it('keeps a sample once the pen has actually travelled', () => {
    expect(shouldKeep(point(10, 10), point(12, 12))).toBe(true)
  })

  it('honours a custom threshold', () => {
    expect(shouldKeep(point(0, 0), point(3, 0), 5)).toBe(false)
    expect(shouldKeep(point(0, 0), point(6, 0), 5)).toBe(true)
  })
})

describe('simplify', () => {
  it('leaves one and two point strokes alone', () => {
    expect(simplify([point(1, 1)])).toHaveLength(1)
    expect(simplify([point(1, 1), point(5, 5)])).toHaveLength(2)
  })

  it('collapses collinear noise to the endpoints', () => {
    const straight = [point(0, 0), point(10, 0), point(20, 0), point(30, 0), point(40, 0)]

    expect(simplify(straight)).toEqual([point(0, 0), point(40, 0)])
  })

  it('keeps a corner', () => {
    const corner = [point(0, 0), point(10, 0), point(20, 0), point(20, 10), point(20, 20)]
    const result = simplify(corner)

    // The turn at (20, 0) has to survive or an L becomes a diagonal.
    expect(result).toEqual([point(0, 0), point(20, 0), point(20, 20)])
  })

  it('preserves the first and last point exactly', () => {
    const wiggly = Array.from({ length: 40 }, (_unused, index) => point(index, Math.sin(index / 3) * 8))
    const result = simplify(wiggly)

    expect(result[0]).toEqual(wiggly[0])
    expect(result.at(-1)).toEqual(wiggly.at(-1))
  })

  it('reduces a noisy line substantially while keeping its shape', () => {
    const noisy = Array.from({ length: 200 }, (_unused, index) =>
      point(index * 0.5, Math.sin(index / 20) * 20 + (index % 2) * 0.2)
    )
    const result = simplify(noisy)

    expect(result.length).toBeLessThan(noisy.length / 3)
    expect(result.length).toBeGreaterThan(4)
  })

  it('handles a stroke that returns to its start', () => {
    // A degenerate segment has no direction to measure against.
    const loop = [point(10, 10), point(20, 20), point(10, 10)]

    expect(() => simplify(loop)).not.toThrow()
    expect(simplify(loop).length).toBeGreaterThanOrEqual(2)
  })

  it('does nothing when the tolerance is zero', () => {
    const points = [point(0, 0), point(10, 0), point(20, 0)]

    expect(simplify(points, 0)).toEqual(points)
  })
})

describe('toSmoothPath', () => {
  it('returns nothing for an empty stroke', () => {
    expect(toSmoothPath([])).toBe('')
  })

  it('renders a single tap as a zero-length line, so a round cap shows a dot', () => {
    expect(toSmoothPath([point(5, 6)])).toBe('M 5 6 l 0 0')
  })

  it('renders two points as a straight line', () => {
    expect(toSmoothPath([point(0, 0), point(10, 10)])).toBe('M 0 0 L 10 10')
  })

  it('renders three or more points as cubic curves through every point', () => {
    const path = toSmoothPath([point(0, 0), point(10, 10), point(20, 0)])

    expect(path.startsWith('M 0 0')).toBe(true)
    expect(path.match(/C/g)).toHaveLength(2)
    // The spline interpolates, so the final sample appears verbatim.
    expect(path.endsWith('20 0')).toBe(true)
  })

  it('passes through the intermediate samples rather than near them', () => {
    const path = toSmoothPath([point(0, 0), point(10, 10), point(20, 0)])

    expect(path).toContain('10 10')
  })

  it('rounds coordinates to two decimals to keep payloads small', () => {
    const path = toSmoothPath([point(0.123456, 0.987654), point(10, 10)])

    expect(path).toContain('0.12')
    expect(path).not.toContain('0.123456')
  })
})

describe('strokeBounds', () => {
  it('returns null when nothing is drawn', () => {
    expect(strokeBounds([])).toBeNull()
    expect(strokeBounds([stroke([])])).toBeNull()
  })

  it('spans every point of every stroke', () => {
    const bounds = strokeBounds([stroke([point(10, 20), point(30, 40)]), stroke([point(5, 60)])])

    expect(bounds).toEqual({ x: 5, y: 20, width: 25, height: 40 })
  })
})

describe('fittedViewBox', () => {
  it('falls back to the whole surface when nothing is drawn', () => {
    expect(fittedViewBox([], 320, 240)).toBe('0 0 320 240')
  })

  it('frames the writing with padding rather than the empty paper', () => {
    const drawn = [stroke([point(100, 100), point(140, 120)])]
    const [x, y, width, height] = fittedViewBox(drawn, 320, 240).split(' ').map(Number)

    // Tighter than the surface, but containing the strokes with room to spare.
    expect(x).toBeLessThan(100)
    expect(y).toBeLessThan(100)
    expect(x! + width!).toBeGreaterThan(140)
    expect(y! + height!).toBeGreaterThan(120)
    expect(width).toBeLessThan(320)
  })

  it('pads by at least the widest stroke so a thick line is not clipped', () => {
    const thick = [stroke([point(50, 50), point(60, 60)], 20)]
    const [x] = fittedViewBox(thick, 320, 240).split(' ').map(Number)

    expect(x).toBeLessThanOrEqual(30)
  })
})

describe('totalPoints and distance', () => {
  it('counts points across strokes', () => {
    expect(totalPoints([stroke([point(0, 0), point(1, 1)]), stroke([point(2, 2)])])).toBe(3)
  })

  it('measures euclidean distance', () => {
    expect(distance(point(0, 0), point(3, 4))).toBe(5)
  })
})

describe('distanceToSegment', () => {
  const a = point(0, 0)
  const b = point(10, 0)

  it('measures perpendicular distance to the middle of a segment', () => {
    expect(distanceToSegment(point(5, 3), a, b)).toBeCloseTo(3)
  })

  it('clamps to the ends rather than measuring the infinite line', () => {
    // The infinite line through a and b is the x-axis, so an unclamped
    // measure would call this 3 — but the nearest point of the segment is b.
    expect(distanceToSegment(point(20, 3), a, b)).toBeCloseTo(Math.hypot(10, 3))
  })

  it('handles a zero-length segment', () => {
    expect(distanceToSegment(point(3, 4), a, a)).toBeCloseTo(5)
  })
})

describe('strokeHitBy', () => {
  /** A horizontal line from (0,50) to (100,50), recorded as just two points. */
  const line = stroke([point(0, 50), point(100, 50)], 4)

  it('catches an eraser passing over the middle of a long segment', () => {
    // The decisive case: a simplified stroke has no recorded point near the
    // middle, so comparing point-to-point would miss this entirely.
    expect(strokeHitBy(line, [point(50, 52)], 10)).toBe(true)
  })

  it('ignores an eraser that stays clear of the stroke', () => {
    expect(strokeHitBy(line, [point(50, 200)], 10)).toBe(false)
  })

  it("accounts for the stroke's own width", () => {
    const thin = stroke([point(0, 50), point(100, 50)], 1)
    const thick = stroke([point(0, 50), point(100, 50)], 40)

    // 25px away: outside a thin line's reach, inside a thick one's.
    expect(strokeHitBy(thin, [point(50, 25)], 10)).toBe(false)
    expect(strokeHitBy(thick, [point(50, 25)], 10)).toBe(true)
  })

  it('catches a dot, which has no segment to measure against', () => {
    const dot = stroke([point(30, 30)], 6)

    expect(strokeHitBy(dot, [point(33, 33)], 10)).toBe(true)
    expect(strokeHitBy(dot, [point(300, 300)], 10)).toBe(false)
  })

  it('tests every point of the eraser path, not just its start', () => {
    const path = [point(0, 0), point(0, 25), point(50, 52)]

    expect(strokeHitBy(line, path, 10)).toBe(true)
  })

  it('is false for empty input either side', () => {
    expect(strokeHitBy(stroke([]), [point(0, 0)], 10)).toBe(false)
    expect(strokeHitBy(line, [], 10)).toBe(false)
  })

  it('respects the radius', () => {
    expect(strokeHitBy(line, [point(50, 80)], 10)).toBe(false)
    expect(strokeHitBy(line, [point(50, 80)], 40)).toBe(true)
  })
})

describe('eraseStrokes', () => {
  const top = stroke([point(0, 10), point(100, 10)], 3)
  const middle = stroke([point(0, 50), point(100, 50)], 3)
  const bottom = stroke([point(0, 90), point(100, 90)], 3)

  it('removes only the strokes the eraser touched', () => {
    const { kept, removed } = eraseStrokes([top, middle, bottom], [point(50, 50)], 10)

    expect(removed).toEqual([middle])
    expect(kept).toEqual([top, bottom])
  })

  it('can remove several strokes in one pass', () => {
    const { kept, removed } = eraseStrokes([top, middle, bottom], [point(50, 10), point(50, 50)], 10)

    expect(removed).toHaveLength(2)
    expect(kept).toEqual([bottom])
  })

  it('keeps everything when the eraser misses', () => {
    const { kept, removed } = eraseStrokes([top, middle, bottom], [point(500, 500)], 10)

    expect(removed).toHaveLength(0)
    expect(kept).toHaveLength(3)
  })

  it('preserves the order of what it keeps, so drawing order survives', () => {
    const { kept } = eraseStrokes([top, middle, bottom], [point(50, 50)], 10)

    expect(kept[0]).toBe(top)
    expect(kept[1]).toBe(bottom)
  })

  it('erases strokes whole rather than splitting them', () => {
    // Crossing the middle of a line removes all of it, not two stubs.
    const { kept, removed } = eraseStrokes([middle], [point(50, 50)], 10)

    expect(kept).toHaveLength(0)
    expect(removed[0]?.points).toHaveLength(2)
  })

  it('handles an empty canvas', () => {
    expect(eraseStrokes([], [point(0, 0)], 10)).toEqual({ kept: [], removed: [] })
  })
})

describe('toSmoothPath corner handling', () => {
  /**
   * Extracts the control points of each cubic segment, so the shape of the
   * curve can be reasoned about rather than just its endpoints.
   */
  function cubics(path: string) {
    return [...path.matchAll(/C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/g)].map(m => ({
      c1: { x: Number(m[1]), y: Number(m[2]) },
      c2: { x: Number(m[3]), y: Number(m[4]) },
      end: { x: Number(m[5]), y: Number(m[6]) }
    }))
  }

  it('keeps a right angle crisp instead of rounding it off', () => {
    // A hand-drawn rectangle corner. Smoothed blindly, this bulges outward
    // and the shape reads as a blob.
    const corner = [point(0, 0), point(100, 0), point(100, 100)]
    const segments = cubics(toSmoothPath(corner))

    // Approaching the corner, the control point must stay on the incoming
    // line (y = 0) rather than being pulled towards the outgoing direction.
    expect(segments[0]?.c2.y).toBeCloseTo(0, 5)
    // Leaving it, the control point stays on the outgoing line (x = 100).
    expect(segments[1]?.c1.x).toBeCloseTo(100, 5)
  })

  it('still smooths a gentle curve', () => {
    // A shallow arc: each turn is well under the corner threshold, so the
    // control points should be pulled across their neighbours.
    const arc = [point(0, 0), point(10, 4), point(20, 6), point(30, 4), point(40, 0)]
    const segments = cubics(toSmoothPath(arc))

    // If this were treated as corners, c2 of the first segment would sit on
    // the straight line from (0,0) to (10,4) — y = 4 - (4/6).
    expect(segments[0]?.c2.y).not.toBeCloseTo(4 - 4 / 6, 3)
  })

  it('passes through every recorded point either way', () => {
    const shape = [point(0, 0), point(100, 0), point(100, 100), point(0, 100)]
    const path = toSmoothPath(shape)

    for (const p of shape.slice(1)) {
      expect(path).toContain(`${p.x} ${p.y}`)
    }
  })

  it('treats a doubled-up point as no turn at all', () => {
    // Two identical points give a zero-length direction; the angle test must
    // not divide by zero or report a corner.
    expect(() => toSmoothPath([point(0, 0), point(10, 10), point(10, 10), point(20, 0)])).not.toThrow()
  })

  it('handles a full reversal, the sharpest possible turn', () => {
    const spike = [point(0, 0), point(50, 0), point(0, 0.5)]
    const segments = cubics(toSmoothPath(spike))

    expect(segments).toHaveLength(2)
    expect(segments[0]?.c2.y).toBeCloseTo(0, 5)
  })
})

describe('inkSignature', () => {
  it('ignores the key order a jsonb round trip comes back in', () => {
    const drawn = [stroke([point(1, 2), point(3, 4)])]

    // What Postgres hands back: same values, keys sorted by jsonb's rules.
    const reloaded = [
      {
        width: 3,
        colour: '#1a1f2b',
        points: [
          { p: 0.5, x: 1, y: 2 },
          { p: 0.5, x: 3, y: 4 }
        ]
      }
    ] as InkStroke[]

    expect(JSON.stringify(reloaded)).not.toBe(JSON.stringify(drawn))
    expect(inkSignature(reloaded)).toBe(inkSignature(drawn))
  })

  it('notices a change to any part of a stroke', () => {
    const original = [stroke([point(1, 2), point(3, 4)])]

    expect(inkSignature([stroke([point(1, 2), point(3, 5)])])).not.toBe(inkSignature(original))
    expect(inkSignature([stroke([point(1, 2), point(3, 4)], 8)])).not.toBe(inkSignature(original))
    expect(inkSignature([stroke([point(1, 2), point(3, 4)], 3, '#b3261e')])).not.toBe(inkSignature(original))
    expect(inkSignature([stroke([point(1, 2)])])).not.toBe(inkSignature(original))
    expect(inkSignature([...original, stroke([point(9, 9)])])).not.toBe(inkSignature(original))
  })

  it('distinguishes an empty drawing from one with ink', () => {
    expect(inkSignature([])).toBe(inkSignature([]))
    expect(inkSignature([stroke([point(0, 0)])])).not.toBe(inkSignature([]))
  })

  it('keeps strokes distinct from each other when they are reordered', () => {
    const a = stroke([point(1, 1)])
    const b = stroke([point(2, 2)])

    expect(inkSignature([a, b])).not.toBe(inkSignature([b, a]))
  })
})
