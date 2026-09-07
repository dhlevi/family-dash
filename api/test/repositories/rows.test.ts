import { describe, expect, it } from 'vitest'
import { buildUpdate, toDateOnly, toIso, toIsoRequired } from '../../lib/repositories/rows'

describe('toIso', () => {
  it('formats a date and passes null through', () => {
    expect(toIso(new Date('2026-09-15T17:00:00Z'))).toBe('2026-09-15T17:00:00.000Z')
    expect(toIso(null)).toBeNull()
    expect(toIso(undefined)).toBeNull()
  })

  it('always returns a string for a NOT NULL column', () => {
    expect(toIsoRequired(new Date('2026-09-15T17:00:00Z'))).toBe('2026-09-15T17:00:00.000Z')
  })
})

describe('toDateOnly', () => {
  it('keeps a plain date string as it is', () => {
    expect(toDateOnly('2026-09-15')).toBe('2026-09-15')
    expect(toDateOnly('2026-09-15T00:00:00.000Z')).toBe('2026-09-15')
  })

  it('formats from UTC fields so the day does not shift west of Greenwich', () => {
    // A `date` column has no time or zone. Reading local fields here would
    // report the 14th for anyone in the Americas.
    expect(toDateOnly(new Date(Date.UTC(2026, 8, 15)))).toBe('2026-09-15')
    expect(toDateOnly(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01')
  })

  it('pads single-digit months and days', () => {
    expect(toDateOnly(new Date(Date.UTC(2026, 2, 5)))).toBe('2026-03-05')
  })
})

describe('buildUpdate', () => {
  it('includes only the fields that were supplied', () => {
    const { clause, params } = buildUpdate({ title: 'New title', notes: undefined, priority: 2 })

    // `notes: undefined` means "not supplied" and must not be written, or a
    // PATCH of one field would null out the others.
    expect(clause).toBe('title = $1, priority = $2')
    expect(params).toEqual(['New title', 2])
  })

  it('treats an explicit null as a value to write', () => {
    const { clause, params } = buildUpdate({ due_at: null })

    expect(clause).toBe('due_at = $1')
    expect(params).toEqual([null])
  })

  it('offsets placeholders when asked', () => {
    const { clause } = buildUpdate({ a: 1, b: 2 }, 3)

    expect(clause).toBe('a = $3, b = $4')
  })

  it('returns an empty clause when nothing was supplied', () => {
    const { clause, params } = buildUpdate({ title: undefined })

    expect(clause).toBe('')
    expect(params).toEqual([])
  })
})
