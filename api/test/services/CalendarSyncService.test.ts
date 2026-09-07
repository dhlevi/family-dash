import { beforeAll, describe, expect, it } from 'vitest'
import { AppProperties } from '../../lib/core/AppProperties'
import { CalendarSyncService } from '../../lib/services/CalendarSyncService'

beforeAll(() => {
  AppProperties.reset()
  AppProperties.initialize('/definitely/not/here.properties')
})

describe('CalendarSyncService.window', () => {
  it('spans the configured past and future range around now', () => {
    const { from, to } = CalendarSyncService.window()
    const now = Date.now()

    const pastDays = (now - from.getTime()) / 86_400_000
    const futureDays = (to.getTime() - now) / 86_400_000

    // Defaults are 45 days back and 365 forward.
    expect(pastDays).toBeGreaterThan(44)
    expect(pastDays).toBeLessThan(47)
    expect(futureDays).toBeGreaterThan(364)
    expect(futureDays).toBeLessThan(367)
  })

  it('covers whole days at both ends', () => {
    const { from, to } = CalendarSyncService.window()

    // Anchoring to day boundaries keeps a sync's delete-and-insert window
    // aligned with the one the previous sync used, so events on the edge are
    // not repeatedly dropped and re-added.
    expect(from.getUTCHours()).toBe(0)
    expect(from.getUTCMinutes()).toBe(0)
    expect(to.getUTCHours()).toBe(23)
    expect(to.getUTCMinutes()).toBe(59)
  })

  it('respects configured overrides', () => {
    AppProperties.reset()
    // AppProperties splits camelCase when generating the environment name:
    // calendar.sync.pastDays -> CALENDAR_SYNC_PAST_DAYS
    process.env.CALENDAR_SYNC_PAST_DAYS = '7'
    process.env.CALENDAR_SYNC_FUTURE_DAYS = '30'
    AppProperties.initialize('/definitely/not/here.properties')

    try {
      const { from, to } = CalendarSyncService.window()
      expect((Date.now() - from.getTime()) / 86_400_000).toBeLessThan(9)
      expect((to.getTime() - Date.now()) / 86_400_000).toBeLessThan(32)
    } finally {
      delete process.env.CALENDAR_SYNC_PAST_DAYS
      delete process.env.CALENDAR_SYNC_FUTURE_DAYS
      AppProperties.reset()
      AppProperties.initialize('/definitely/not/here.properties')
    }
  })
})
