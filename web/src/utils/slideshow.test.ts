import { describe, expect, it } from 'vitest'
import { interleave } from './slideshow'

describe('interleave', () => {
  it('alternates between the two sources', () => {
    expect(interleave(['a', 'b', 'c'], [1, 2, 3])).toEqual(['a', 1, 'b', 2, 'c', 3])
  })

  it('carries on with whichever list is longer', () => {
    expect(interleave(['a', 'b', 'c', 'd'], [1])).toEqual(['a', 1, 'b', 'c', 'd'])
    expect(interleave(['a'], [1, 2, 3])).toEqual(['a', 1, 2, 3])
  })

  it('returns the other list when one is empty', () => {
    expect(interleave([], [1, 2])).toEqual([1, 2])
    expect(interleave(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('is empty when both are', () => {
    expect(interleave([], [])).toEqual([])
  })

  it('keeps falsy entries rather than dropping them', () => {
    // A naive `if (first[index])` guard silently loses a 0 or an empty string.
    expect(interleave([0, 1], ['', 'x'])).toEqual([0, '', 1, 'x'])
  })
})
