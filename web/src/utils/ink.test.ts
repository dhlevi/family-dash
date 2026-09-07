import { describe, expect, it } from 'vitest'
import { distance, fittedViewBox, shouldKeep, simplify, strokeBounds, toSmoothPath, totalPoints } from './ink'
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
