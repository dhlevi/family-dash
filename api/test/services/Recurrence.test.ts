import { describe, expect, it } from 'vitest'
import { describeRecurrence, isRecurrence, nextOccurrence, RECURRENCES } from '../../lib/services/Recurrence'

/**
 * Recurrence decides when a chore reappears, and getting it wrong is the
 * kind of bug nobody reports — the bins task just quietly drifts to the
 * wrong day.
 *
 * Dates are constructed with local-time components throughout, because that
 * is the arithmetic the implementation does and what "every Monday at 7pm"
 * means to a household.
 */
const local = (year: number, month: number, day: number, hour = 19) => new Date(year, month - 1, day, hour)

describe('isRecurrence', () => {
  it('accepts the supported kinds and nothing else', () => {
    for (const kind of RECURRENCES) expect(isRecurrence(kind)).toBe(true)

    expect(isRecurrence(null)).toBe(false)
    expect(isRecurrence('yearly')).toBe(false)
    expect(isRecurrence('FREQ=WEEKLY')).toBe(false)
  })
})

describe('nextOccurrence', () => {
  it('returns null when the task does not recur', () => {
    expect(nextOccurrence(null, local(2026, 9, 7))).toBeNull()
    expect(nextOccurrence('sometimes', local(2026, 9, 7))).toBeNull()
  })

  it('advances a daily task by one day', () => {
    const next = nextOccurrence('daily', local(2026, 9, 7), local(2026, 9, 7, 20))

    expect(next).toEqual(local(2026, 9, 8))
  })

  it('advances a weekly task by seven days, keeping the weekday', () => {
    const monday = local(2026, 9, 7)
    const next = nextOccurrence('weekly', monday, local(2026, 9, 7, 20))

    expect(next?.getDay()).toBe(monday.getDay())
    expect(next).toEqual(local(2026, 9, 14))
  })

  it('advances a fortnightly task by fourteen days', () => {
    expect(nextOccurrence('fortnightly', local(2026, 9, 7), local(2026, 9, 7, 20))).toEqual(local(2026, 9, 21))
  })

  it('skips the weekend for a weekdays task', () => {
    // 11 September 2026 is a Friday.
    const friday = local(2026, 9, 11)
    expect(friday.getDay()).toBe(5)

    const next = nextOccurrence('weekdays', friday, local(2026, 9, 11, 20))

    // Monday, not Saturday.
    expect(next?.getDay()).toBe(1)
    expect(next).toEqual(local(2026, 9, 14))
  })

  it('preserves the time of day', () => {
    const next = nextOccurrence('daily', local(2026, 9, 7, 7), local(2026, 9, 7, 20))

    expect(next?.getHours()).toBe(7)
  })

  it('advances a monthly task to the same day of the next month', () => {
    expect(nextOccurrence('monthly', local(2026, 9, 15), local(2026, 9, 15, 20))).toEqual(local(2026, 10, 15))
  })

  it('clamps a monthly task to the end of a shorter month', () => {
    // 31 January plus a month is 28 February, not 3 March — otherwise a
    // month-end chore drifts later every month.
    const next = nextOccurrence('monthly', local(2027, 1, 31), local(2027, 1, 31, 20))

    expect(next?.getMonth()).toBe(1)
    expect(next?.getDate()).toBe(28)
  })

  it('clamps to 29 February in a leap year', () => {
    const next = nextOccurrence('monthly', local(2028, 1, 31), local(2028, 1, 31, 20))

    expect(next?.getDate()).toBe(29)
  })

  it('skips past occurrences so completing an overdue chore does not create another overdue one', () => {
    // A daily chore due three weeks ago, ticked off today.
    const longOverdue = local(2026, 8, 17)
    const now = local(2026, 9, 7, 20)

    const next = nextOccurrence('daily', longOverdue, now)

    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeGreaterThan(now.getTime())
    // The first future occurrence, not an arbitrary jump forward.
    expect(next).toEqual(local(2026, 9, 8))
  })

  it('keeps a weekly chore on its original weekday even when it is weeks overdue', () => {
    const monday = local(2026, 8, 10)
    expect(monday.getDay()).toBe(1)

    const next = nextOccurrence('weekly', monday, local(2026, 9, 7, 20))

    expect(next?.getDay()).toBe(1)
    expect(next!.getTime()).toBeGreaterThan(local(2026, 9, 7, 20).getTime())
  })
})

describe('describeRecurrence', () => {
  it('has a label for every supported kind', () => {
    for (const kind of RECURRENCES) {
      expect(describeRecurrence(kind)).toMatch(/^Every/)
    }
  })
})
