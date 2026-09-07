import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  formatEventSpan,
  formatRelativeDay,
  fromDateInput,
  isSameDay,
  monthGrid,
  startOfMonth,
  startOfWeek,
  toDateInput,
  weekdayNames
} from './datetime'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

/**
 * All-day events come from the API at UTC midnight, which is what makes them
 * mean the same calendar date in every timezone. Fixtures must match, or
 * these tests pass while the UI renders a day out.
 */
const allDayIso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString()

describe('startOfWeek', () => {
  it('rewinds to Sunday by default', () => {
    // 9 September 2026 is a Wednesday.
    expect(startOfWeek(local(2026, 9, 9)).getDay()).toBe(0)
    expect(startOfWeek(local(2026, 9, 9))).toEqual(local(2026, 9, 6))
  })

  it('rewinds to Monday when the week starts on Monday', () => {
    expect(startOfWeek(local(2026, 9, 9), 1)).toEqual(local(2026, 9, 7))
  })

  it('leaves a date already on the first day alone', () => {
    expect(startOfWeek(local(2026, 9, 6), 0)).toEqual(local(2026, 9, 6))
    expect(startOfWeek(local(2026, 9, 7), 1)).toEqual(local(2026, 9, 7))
  })
})

describe('addMonths', () => {
  it('keeps the day of month where it can', () => {
    expect(addMonths(local(2026, 9, 15), 1)).toEqual(local(2026, 10, 15))
    expect(addMonths(local(2026, 9, 15), -1)).toEqual(local(2026, 8, 15))
  })

  it('clamps to the end of a shorter month instead of overflowing', () => {
    // Without clamping this lands on 3 March and month navigation skips February.
    const result = addMonths(local(2027, 1, 31), 1)
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(28)
  })
})

describe('endOfMonth', () => {
  it('finds the last day of months of different lengths', () => {
    expect(endOfMonth(local(2026, 9, 5)).getDate()).toBe(30)
    expect(endOfMonth(local(2026, 2, 5)).getDate()).toBe(28)
    expect(endOfMonth(local(2028, 2, 5)).getDate()).toBe(29)
  })
})

describe('monthGrid', () => {
  it('always returns six whole weeks so the grid never changes height', () => {
    for (const month of [local(2026, 2, 1), local(2026, 9, 1), local(2027, 5, 1)]) {
      expect(monthGrid(month)).toHaveLength(42)
    }
  })

  it('starts on the configured first day of the week', () => {
    expect(monthGrid(local(2026, 9, 1), 0)[0]?.getDay()).toBe(0)
    expect(monthGrid(local(2026, 9, 1), 1)[0]?.getDay()).toBe(1)
  })

  it('covers the whole month', () => {
    const grid = monthGrid(local(2026, 9, 1))
    const first = startOfMonth(local(2026, 9, 1))
    const last = endOfMonth(local(2026, 9, 1))

    expect(grid[0]!.getTime()).toBeLessThanOrEqual(first.getTime())
    expect(grid[41]!.getTime()).toBeGreaterThanOrEqual(last.getTime() - 86_400_000)
  })

  it('runs consecutively with no gaps', () => {
    const grid = monthGrid(local(2026, 3, 1))

    for (let index = 1; index < grid.length; index++) {
      expect(daysBetween(grid[index - 1]!, grid[index]!)).toBe(1)
    }
  })
})

describe('weekdayNames', () => {
  it('returns seven names starting on the configured day', () => {
    expect(weekdayNames(0)).toHaveLength(7)
    expect(weekdayNames(0)[0]).not.toBe(weekdayNames(1)[0])
  })
})

describe('formatRelativeDay', () => {
  const now = local(2026, 9, 7, 12)

  it('names today, tomorrow and yesterday', () => {
    expect(formatRelativeDay(local(2026, 9, 7, 23), now)).toBe('Today')
    expect(formatRelativeDay(local(2026, 9, 8, 1), now)).toBe('Tomorrow')
    expect(formatRelativeDay(local(2026, 9, 6, 23), now)).toBe('Yesterday')
  })

  it('uses the weekday within the coming week', () => {
    expect(formatRelativeDay(local(2026, 9, 10), now)).toMatch(/day$/i)
  })

  it('counts back for the recent past', () => {
    expect(formatRelativeDay(local(2026, 9, 3), now)).toBe('4 days ago')
  })

  it('falls back to a date further out', () => {
    expect(formatRelativeDay(local(2026, 11, 3), now)).toMatch(/Nov/)
  })

  it('treats late tonight as today, not tomorrow', () => {
    // Comparing whole days rather than 24-hour spans is what makes this work.
    expect(formatRelativeDay(local(2026, 9, 7, 23, 59), local(2026, 9, 7, 0, 1))).toBe('Today')
  })
})

describe('formatEventSpan', () => {
  it('shows a time range for a same-day timed event', () => {
    const span = formatEventSpan(local(2026, 9, 15, 17).toISOString(), local(2026, 9, 15, 18, 30).toISOString(), false)
    expect(span).toMatch(/–/)
    expect(span).not.toMatch(/Sep/)
  })

  it('says "All day" for a single all-day event', () => {
    // The API stores an exclusive end, so one day spans midnight to midnight.
    const span = formatEventSpan(allDayIso(2026, 9, 20), allDayIso(2026, 9, 21), true)
    expect(span).toBe('All day')
  })

  it('counts a multi-day all-day event to the day before the exclusive end', () => {
    const span = formatEventSpan(allDayIso(2026, 9, 26), allDayIso(2026, 9, 28), true)
    // 26th to 28th exclusive is the 26th and 27th, so it must not say the 28th.
    expect(span).toMatch(/27/)
    expect(span).not.toMatch(/28/)
  })

  it('includes both dates when a timed event crosses midnight', () => {
    const span = formatEventSpan(local(2026, 9, 15, 22).toISOString(), local(2026, 9, 16, 1).toISOString(), false)
    expect(span.match(/Sep/g)?.length).toBe(2)
  })
})

describe('date input round-trip', () => {
  it('parses a date-only value as local midnight, not UTC', () => {
    // `new Date('2026-09-15')` is UTC midnight, which is the 14th in the
    // Americas — the classic off-by-one in date pickers.
    const parsed = fromDateInput('2026-09-15')

    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(8)
    expect(parsed?.getDate()).toBe(15)
    expect(parsed?.getHours()).toBe(0)
  })

  it('round-trips through toDateInput', () => {
    const original = local(2026, 3, 5)
    expect(fromDateInput(toDateInput(original))).toEqual(original)
  })

  it('parses a datetime-local value', () => {
    const parsed = fromDateInput('2026-09-15T19:30')

    expect(parsed?.getHours()).toBe(19)
    expect(parsed?.getMinutes()).toBe(30)
  })

  it('returns null for empty or unparseable input', () => {
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('not a date')).toBeNull()
  })
})

describe('isSameDay', () => {
  it('compares calendar days, not instants', () => {
    expect(isSameDay(local(2026, 9, 7, 0, 1), local(2026, 9, 7, 23, 59))).toBe(true)
    expect(isSameDay(local(2026, 9, 7, 23, 59), local(2026, 9, 8, 0, 1))).toBe(false)
  })
})

describe('addDays', () => {
  it('preserves the time of day across a month boundary', () => {
    const result = addDays(local(2026, 9, 30, 19), 1)
    expect(result).toEqual(local(2026, 10, 1, 19))
  })
})
