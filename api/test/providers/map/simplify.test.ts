import { describe, expect, it } from 'vitest'
import { lineLength, ringArea, simplify } from '../../../lib/providers/map/simplify'

describe('simplify', () => {
  it('drops points that sit on the line between their neighbours', () => {
    expect(simplify([0, 0, 5, 0, 10, 0], 0.3)).toEqual([0, 0, 10, 0])
  })

  it('keeps a point that is far enough off it', () => {
    expect(simplify([0, 0, 5, 4, 10, 0], 0.3)).toEqual([0, 0, 5, 4, 10, 0])
  })

  it('always keeps both ends', () => {
    const reduced = simplify([0, 0, 1, 0.01, 2, 0.02, 3, 0], 1)

    expect(reduced.slice(0, 2)).toEqual([0, 0])
    expect(reduced.slice(-2)).toEqual([3, 0])
  })

  it('leaves a two-point line alone', () => {
    expect(simplify([0, 0, 1, 1], 10)).toEqual([0, 0, 1, 1])
  })

  it('handles a ring long enough to overflow a recursive implementation', () => {
    // A complicated shoreline in a single tile really does run to thousands of
    // points, which is why this is iterative.
    const coordinates: number[] = []
    for (let index = 0; index < 8000; index++) coordinates.push(index, Math.sin(index / 40) * 30)

    expect(() => simplify(coordinates, 0.3)).not.toThrow()
    expect(simplify(coordinates, 5).length).toBeLessThan(coordinates.length)
  })

  it('gives up on geometry that would make Douglas-Peucker quadratic', () => {
    // A sawtooth taller than the tolerance at every step: nothing can be
    // discarded, so the recursion splits at every point. Left unguarded this
    // is minutes of CPU on input that arrived over the network.
    const coordinates: number[] = []
    for (let index = 0; index < 40_000; index++) coordinates.push(index, index % 2 === 0 ? 0 : 40)

    const started = Date.now()
    const reduced = simplify(coordinates, 0.3)

    expect(Date.now() - started).toBeLessThan(1000)
    expect(reduced.length).toBeGreaterThan(0)
  })
})

describe('ringArea', () => {
  it('measures a square', () => {
    expect(ringArea([0, 0, 10, 0, 10, 10, 0, 10])).toBe(100)
  })

  it('ignores winding, because the renderer fills with the even-odd rule', () => {
    expect(ringArea([0, 10, 10, 10, 10, 0, 0, 0])).toBe(100)
  })
})

describe('lineLength', () => {
  it('sums the segments', () => {
    expect(lineLength([0, 0, 3, 4, 3, 9])).toBe(10)
  })

  it('is zero for a single point', () => {
    expect(lineLength([5, 5])).toBe(0)
  })
})
