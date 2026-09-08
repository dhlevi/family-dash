import { effectScope, ref, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdle } from './useIdle'

/**
 * The idle watcher behind the screensaver.
 *
 * The failure that matters is a display that never goes idle, because
 * something keeps counting as activity — or one that goes idle while
 * somebody is standing there using it.
 */
function withIdle(minutes = 5) {
  const scope = effectScope()
  const setting = ref(minutes)
  const result = scope.run(() => useIdle(setting))!

  return { ...result, setting, dispose: () => scope.stop() }
}

const tap = () => window.dispatchEvent(new Event('pointerdown'))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useIdle', () => {
  it('is not idle to begin with', () => {
    const { idle, dispose } = withIdle()

    expect(idle.value).toBe(false)
    dispose()
  })

  it('goes idle once the configured time passes untouched', () => {
    const { idle, dispose } = withIdle(5)

    vi.advanceTimersByTime(4 * 60_000)
    expect(idle.value).toBe(false)

    vi.advanceTimersByTime(60_000)
    expect(idle.value).toBe(true)

    dispose()
  })

  it('starts the count again on a tap', () => {
    const { idle, dispose } = withIdle(5)

    vi.advanceTimersByTime(4 * 60_000)
    tap()
    vi.advanceTimersByTime(4 * 60_000)

    // Eight minutes have passed, but never five in a row.
    expect(idle.value).toBe(false)
    dispose()
  })

  it('wakes on a tap, and counts down again from there', () => {
    const { idle, dispose } = withIdle(5)

    vi.advanceTimersByTime(5 * 60_000)
    expect(idle.value).toBe(true)

    tap()
    expect(idle.value).toBe(false)

    vi.advanceTimersByTime(5 * 60_000)
    expect(idle.value).toBe(true)

    dispose()
  })

  it('counts a key, a scroll and a touch as activity too', () => {
    for (const event of ['keydown', 'wheel', 'touchstart']) {
      const { idle, dispose } = withIdle(5)

      vi.advanceTimersByTime(5 * 60_000)
      window.dispatchEvent(new Event(event))

      expect(idle.value, event).toBe(false)
      dispose()
    }
  })

  it('does not count a cursor drifting across the screen', () => {
    const { idle, dispose } = withIdle(5)

    // A wall display with a mouse plugged in would otherwise never sleep.
    vi.advanceTimersByTime(4 * 60_000)
    window.dispatchEvent(new Event('pointermove'))
    window.dispatchEvent(new Event('mousemove'))
    vi.advanceTimersByTime(60_000)

    expect(idle.value).toBe(true)
    dispose()
  })

  it('never goes idle when the screensaver is switched off', () => {
    const { idle, dispose } = withIdle(0)

    vi.advanceTimersByTime(24 * 60 * 60_000)

    expect(idle.value).toBe(false)
    dispose()
  })

  it('takes a changed setting without a reload', async () => {
    const { idle, setting, dispose } = withIdle(60)

    setting.value = 2
    await nextTick()
    vi.advanceTimersByTime(2 * 60_000)

    expect(idle.value).toBe(true)
    dispose()
  })

  it('wakes the screen if the screensaver is switched off while it is showing', async () => {
    const { idle, setting, dispose } = withIdle(5)

    vi.advanceTimersByTime(5 * 60_000)
    expect(idle.value).toBe(true)

    setting.value = 0
    await nextTick()

    // Otherwise turning it off in Settings would leave the slideshow up with
    // no way back to the settings page that switched it off.
    expect(idle.value).toBe(false)
    dispose()
  })

  it('stops listening once the scope is gone', () => {
    const { idle, dispose } = withIdle(5)
    dispose()

    vi.advanceTimersByTime(10 * 60_000)
    tap()

    expect(idle.value).toBe(false)
  })
})
