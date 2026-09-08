import { describe, expect, it } from 'vitest'
import { resolveAutoTheme, sunTimesFrom, type SunTimes } from './theme'

/**
 * The automatic theme.
 *
 * Worth testing on its own because it is wrong in the way that nobody
 * notices for months: a boundary off by an hour, or a rule that only holds
 * in summer. Solar times move by a couple of minutes a day and by hours
 * across a year, which is the whole reason for using them rather than fixed
 * clock hours.
 */
const at = (iso: string) => new Date(iso)

/** A midsummer day in Vancouver: up before five, down after nine. */
const summer: SunTimes = { sunrise: at('2026-06-21T12:07:00Z'), sunset: at('2026-06-22T04:21:00Z') }

/** And midwinter in Vancouver: barely eight hours of daylight. */
const winter: SunTimes = { sunrise: at('2026-12-21T16:04:00Z'), sunset: at('2026-12-22T00:16:00Z') }

/** Somewhere further north in December — under four hours of daylight. */
const shortDay: SunTimes = { sunrise: at('2026-12-21T11:00:00Z'), sunset: at('2026-12-21T14:45:00Z') }

describe('resolveAutoTheme with solar times', () => {
  it('is light through the middle of the day and dark at night', () => {
    expect(resolveAutoTheme(at('2026-06-21T20:00:00Z'), summer)).toBe('light')
    expect(resolveAutoTheme(at('2026-06-21T09:00:00Z'), summer)).toBe('dark')
  })

  it('switches on sunrise and sunset, not on the clock', () => {
    // A minute either side of each boundary, with no offset.
    expect(resolveAutoTheme(at('2026-06-21T12:06:00Z'), summer)).toBe('dark')
    expect(resolveAutoTheme(at('2026-06-21T12:08:00Z'), summer)).toBe('light')
    expect(resolveAutoTheme(at('2026-06-22T04:20:00Z'), summer)).toBe('light')
    expect(resolveAutoTheme(at('2026-06-22T04:22:00Z'), summer)).toBe('dark')
  })

  it('follows the season rather than a fixed hour', () => {
    // 15:00 UTC is before a December sunrise and long after a June one.
    expect(resolveAutoTheme(at('2026-06-21T15:00:00Z'), summer)).toBe('light')
    expect(resolveAutoTheme(at('2026-12-21T15:00:00Z'), winter)).toBe('dark')
  })

  it('waits out the offset after sunrise before going light', () => {
    // Sunrise is 12:07; with half an hour of grace the screen stays dark
    // until 12:37, which is the point of the setting.
    expect(resolveAutoTheme(at('2026-06-21T12:20:00Z'), summer, 30)).toBe('dark')
    expect(resolveAutoTheme(at('2026-06-21T12:40:00Z'), summer, 30)).toBe('light')
  })

  it('goes dark the offset before sunset', () => {
    expect(resolveAutoTheme(at('2026-06-22T03:40:00Z'), summer, 30)).toBe('light')
    expect(resolveAutoTheme(at('2026-06-22T04:00:00Z'), summer, 30)).toBe('dark')
  })

  it('still finds a light window on a short winter day', () => {
    // Eight hours of daylight, shrunk by three at each end, leaves two in
    // the middle. Nothing exceptional — just narrow.
    expect(resolveAutoTheme(at('2026-12-21T20:00:00Z'), winter, 180)).toBe('light')
    expect(resolveAutoTheme(at('2026-12-21T18:00:00Z'), winter, 180)).toBe('dark')
  })

  it('stays dark all day when the offset is wider than the daylight', () => {
    // Under four hours of daylight, asked to shrink by two and a half at
    // each end. Rather than inverting — light at dusk, dark at noon — it
    // reads that as "keep it dark", which is what asking for a wide offset
    // at that latitude means.
    expect(resolveAutoTheme(at('2026-12-21T12:50:00Z'), shortDay, 150)).toBe('dark')
    expect(resolveAutoTheme(at('2026-12-21T11:00:00Z'), shortDay, 150)).toBe('dark')

    // And with no offset the same day is light in the middle, so the rule is
    // about the offset rather than the latitude.
    expect(resolveAutoTheme(at('2026-12-21T12:50:00Z'), shortDay)).toBe('light')
  })
})

describe('resolveAutoTheme without solar times', () => {
  it('falls back to fixed local hours', () => {
    // First run with no forecast yet, or a latitude where the sun does not
    // set. Local hours, because that is all there is to go on.
    const morning = new Date(2026, 5, 21, 9, 0)
    const night = new Date(2026, 5, 21, 23, 0)

    expect(resolveAutoTheme(morning, null)).toBe('light')
    expect(resolveAutoTheme(night, null)).toBe('dark')
  })

  it('puts the fallback boundaries at 07:00 and 19:00', () => {
    expect(resolveAutoTheme(new Date(2026, 5, 21, 6, 59), null)).toBe('dark')
    expect(resolveAutoTheme(new Date(2026, 5, 21, 7, 0), null)).toBe('light')
    expect(resolveAutoTheme(new Date(2026, 5, 21, 18, 59), null)).toBe('light')
    expect(resolveAutoTheme(new Date(2026, 5, 21, 19, 0), null)).toBe('dark')
  })

  it('ignores the offset, which has nothing to apply to', () => {
    expect(resolveAutoTheme(new Date(2026, 5, 21, 9, 0), null, 180)).toBe('light')
  })
})

describe('sunTimesFrom', () => {
  it('parses a pair of ISO times', () => {
    const times = sunTimesFrom('2026-06-21T12:07:00Z', '2026-06-22T04:21:00Z')

    expect(times?.sunrise.toISOString()).toBe('2026-06-21T12:07:00.000Z')
    expect(times?.sunset.toISOString()).toBe('2026-06-22T04:21:00.000Z')
  })

  it('reports nothing when the provider gave no times', () => {
    // Open-Meteo returns nulls above the Arctic circle in midsummer.
    expect(sunTimesFrom(null, null)).toBeNull()
    expect(sunTimesFrom('2026-06-21T12:07:00Z', null)).toBeNull()
  })

  it('rejects times it cannot reason about', () => {
    expect(sunTimesFrom('not a date', '2026-06-22T04:21:00Z')).toBeNull()
    // Sunset before sunrise: the fixed fallback beats trusting this.
    expect(sunTimesFrom('2026-06-22T04:21:00Z', '2026-06-21T12:07:00Z')).toBeNull()
  })
})
