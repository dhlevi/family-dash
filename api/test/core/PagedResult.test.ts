import { describe, expect, it } from 'vitest'
import { MAX_PAGE_SIZE, normalizePaging, toPagedResult } from '../../lib/core/model/PagedResult'

describe('normalizePaging', () => {
  it('defaults missing values', () => {
    expect(normalizePaging()).toEqual({ page: 1, pageSize: 50, offset: 0 })
  })

  it('computes the offset from the page', () => {
    expect(normalizePaging(3, 20)).toEqual({ page: 3, pageSize: 20, offset: 40 })
  })

  it('rejects zero, negative and fractional pages', () => {
    expect(normalizePaging(0, 10).page).toBe(1)
    expect(normalizePaging(-5, 10).page).toBe(1)
    expect(normalizePaging(2.7, 10).page).toBe(2)
  })

  it('caps the page size so a caller cannot ask for the whole library', () => {
    expect(normalizePaging(1, 100_000).pageSize).toBe(MAX_PAGE_SIZE)
  })

  it('builds the envelope with a page count', () => {
    expect(toPagedResult(['a', 'b'], 5, 1, 2)).toEqual({
      items: ['a', 'b'],
      total: 5,
      page: 1,
      pageSize: 2,
      pages: 3
    })
  })
})
