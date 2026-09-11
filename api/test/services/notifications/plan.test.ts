import { describe, expect, it } from 'vitest'
import {
  decide,
  isQuiet,
  planStateChange,
  shiftOutOfQuiet,
  type CheckState,
  type QuietHours
} from '../../../lib/services/notifications/plan'

/**
 * The two rules here are what stand between a helpful reminder and a household
 * turning notifications off for good: never at three in the morning, and never
 * a backlog after a power cut.
 */
const NIGHT: QuietHours = { from: 21, to: 7 }
const OFF: QuietHours = { from: 0, to: 0 }

const at = (iso: string) => new Date(iso)

describe('isQuiet', () => {
  it.each([
    [22, true],
    [3, true],
    [6, true],
    [7, false],
    [12, false],
    [20, false],
    [21, true]
  ])('hour %i inside a window that wraps midnight: %s', (hour, expected) => {
    expect(isQuiet(hour, NIGHT)).toBe(expected)
  })

  it('handles a window that does not wrap', () => {
    const daytime: QuietHours = { from: 9, to: 17 }

    expect(isQuiet(12, daytime)).toBe(true)
    expect(isQuiet(20, daytime)).toBe(false)
  })

  it('is never quiet when the window is switched off', () => {
    for (let hour = 0; hour < 24; hour++) expect(isQuiet(hour, OFF)).toBe(false)
  })
})

describe('shiftOutOfQuiet', () => {
  it('moves a small-hours reminder to when the window closes', () => {
    expect(shiftOutOfQuiet(at('2026-09-15T03:20:00'), NIGHT).getHours()).toBe(7)
  })

  it('carries a late-evening reminder over to the next morning', () => {
    const shifted = shiftOutOfQuiet(at('2026-09-15T22:40:00'), NIGHT)

    expect(shifted.getDate()).toBe(16)
    expect(shifted.getHours()).toBe(7)
  })

  it('leaves a daytime reminder exactly where it is', () => {
    const fireAt = at('2026-09-15T14:30:00')

    expect(shiftOutOfQuiet(fireAt, NIGHT)).toEqual(fireAt)
  })

  it('does nothing when quiet hours are off', () => {
    const fireAt = at('2026-09-15T03:20:00')

    expect(shiftOutOfQuiet(fireAt, OFF)).toEqual(fireAt)
  })
})

describe('decide', () => {
  it('holds a reminder whose moment has not come', () => {
    expect(decide({ fireAt: at('2026-09-15T14:00:00') }, at('2026-09-15T13:30:00'), OFF, 30)).toEqual({
      action: 'hold'
    })
  })

  it('sends one that is due now', () => {
    const result = decide({ fireAt: at('2026-09-15T14:00:00') }, at('2026-09-15T14:00:00'), OFF, 30)

    expect(result.action).toBe('send')
  })

  it('sends one that is a little late', () => {
    // The sweep runs every few minutes, so everything is slightly late.
    expect(decide({ fireAt: at('2026-09-15T14:00:00') }, at('2026-09-15T14:04:00'), OFF, 30).action).toBe('send')
  })

  it('expires a backlog rather than delivering it', () => {
    // The Pi was off overnight. Without this the household wakes up to every
    // reminder from the last twelve hours at once.
    const result = decide({ fireAt: at('2026-09-15T02:00:00') }, at('2026-09-15T14:00:00'), OFF, 30)

    expect(result.action).toBe('expire')
  })

  it('holds a small-hours reminder until the morning rather than expiring it', () => {
    // 03:20 shifts to 07:00, which at 04:00 has not happened yet.
    expect(decide({ fireAt: at('2026-09-15T03:20:00') }, at('2026-09-15T04:00:00'), NIGHT, 30).action).toBe('hold')
  })

  it('delivers it once the quiet window closes', () => {
    const result = decide({ fireAt: at('2026-09-15T03:20:00') }, at('2026-09-15T07:02:00'), NIGHT, 30)

    expect(result.action).toBe('send')
    expect(result.action === 'send' && result.fireAt.getHours()).toBe(7)
  })

  it('measures staleness from the shifted moment, not the original', () => {
    // Otherwise every reminder held overnight would be hours stale by the
    // time it was allowed out, and would expire instead of arriving.
    const result = decide({ fireAt: at('2026-09-15T23:00:00') }, at('2026-09-16T07:05:00'), NIGHT, 30)

    expect(result.action).toBe('send')
  })

  it('still expires something the household slept through entirely', () => {
    const result = decide({ fireAt: at('2026-09-15T23:00:00') }, at('2026-09-16T11:00:00'), NIGHT, 30)

    expect(result.action).toBe('expire')
  })
})

describe('planStateChange', () => {
  // A stand-in for the sha1 the service uses; the shape is what matters here.
  const digest = (value: string) => `d(${value})`
  const now = new Date('2026-09-15T14:07:30.000Z')

  const healthy: CheckState = { name: 'calendar-sources', healthy: true, message: '' }
  const failing: CheckState = { name: 'calendar-sources', healthy: false, message: 'Feed returned 403' }

  it('records a first sighting of a healthy check without announcing it', () => {
    // Otherwise the first sweep after setting this up reports that all nine
    // probes are fine, which is not news.
    const change = planStateChange(healthy, null, now, digest)

    expect(change?.announce).toBe(false)
    expect(change?.detail).toBe('ok')
  })

  it('announces a fault the first time it is seen', () => {
    const change = planStateChange(failing, 'ok', now, digest)

    expect(change?.announce).toBe(true)
    expect(change?.healthy).toBe(false)
    expect(change?.detail).toBe('Feed returned 403')
  })

  it('announces a fault even when nothing was recorded before', () => {
    expect(planStateChange(failing, null, now, digest)?.announce).toBe(true)
  })

  it('says nothing about a fault that has not changed', () => {
    expect(planStateChange(failing, 'Feed returned 403', now, digest)).toBeNull()
  })

  it('announces a different fault on the same check', () => {
    const change = planStateChange({ ...failing, message: 'Feed returned 500' }, 'Feed returned 403', now, digest)

    expect(change?.announce).toBe(true)
  })

  it('announces a recovery', () => {
    const change = planStateChange(healthy, 'Feed returned 403', now, digest)

    expect(change?.announce).toBe(true)
    expect(change?.healthy).toBe(true)
  })

  it('gives a recovery a different key from the baseline it returns to', () => {
    // Keyed on the state alone, these collide — and the recovery is deduped
    // against a row written days earlier, so nobody is told it recovered.
    const baseline = planStateChange(healthy, null, new Date('2026-09-10T09:00:00.000Z'), digest)
    const recovery = planStateChange(healthy, 'Feed returned 403', now, digest)

    expect(recovery?.key).not.toBe(baseline?.key)
  })

  it('gives two sweeps in the same minute the same key, so a race sends once', () => {
    const first = planStateChange(failing, 'ok', new Date('2026-09-15T14:07:01.000Z'), digest)
    const second = planStateChange(failing, 'ok', new Date('2026-09-15T14:07:59.000Z'), digest)

    expect(first?.key).toBe(second?.key)
  })

  it('keeps the check name in the key, so states can be looked up by prefix', () => {
    expect(planStateChange(failing, 'ok', now, digest)?.key.startsWith('system:calendar-sources:')).toBe(true)
  })

  it('describes a failing check with no message at all', () => {
    const change = planStateChange({ name: 'media', healthy: false, message: '' }, 'ok', now, digest)

    expect(change?.detail).toBe('failing')
  })
})
