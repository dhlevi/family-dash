import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '@/api/client'
import { systemApi } from '@/api/system'
import type { HealthReport } from '@/api/types'
import { useSystemStore } from './system'

/**
 * The store's job on a wall display is to notice that the API went away and,
 * more importantly, that it came back. Nobody is watching the screen at the
 * moment a Pi finishes booting, so anything that needs a human to tap it is
 * not a recovery.
 */
describe('system store', () => {
  const health = vi.spyOn(systemApi, 'health')

  function report(overrides: Partial<HealthReport> = {}): HealthReport {
    return {
      status: 'ok',
      checks: [],
      tasks: [],
      uptimeSeconds: 12,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      ...overrides
    }
  }

  const healthy = report()
  const unreachable = (): ApiRequestError => new ApiRequestError(0, 'Cannot reach the API', 'NETWORK')

  beforeEach(() => {
    setActivePinia(createPinia())
    health.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays un-connected until the API has actually answered', async () => {
    const store = useSystemStore()
    health.mockRejectedValue(unreachable())

    await store.refresh()

    expect(store.everConnected).toBe(false)
    expect(store.reachable).toBe(false)
    expect(store.status).toBe('offline')
  })

  it('does not remount the view on the first connection', async () => {
    const store = useSystemStore()
    health.mockRejectedValueOnce(unreachable()).mockResolvedValueOnce(healthy)

    await store.refresh()
    await store.refresh()

    expect(store.everConnected).toBe(true)
    // Nothing has mounted yet - the gate was up - so there is nothing to
    // reload, and bumping this would throw away the first paint for nothing.
    expect(store.generation).toBe(0)
  })

  it('bumps the generation when the API returns after an outage', async () => {
    const store = useSystemStore()
    health.mockResolvedValue(healthy)
    await store.refresh()

    health.mockRejectedValue(unreachable())
    await store.refresh()
    expect(store.generation).toBe(0)

    health.mockResolvedValue(healthy)
    await store.refresh()

    expect(store.generation).toBe(1)
  })

  it('does not bump the generation while the API keeps answering', async () => {
    const store = useSystemStore()
    health.mockResolvedValue(healthy)

    await store.refresh()
    await store.refresh()
    await store.refresh()

    expect(store.generation).toBe(0)
  })

  it('keeps the last report when the API answers with a failing check', async () => {
    const store = useSystemStore()
    health.mockResolvedValue(
      report({
        status: 'unhealthy',
        checks: [{ name: 'database', healthy: false, critical: true, durationMs: 4, message: 'connection refused' }]
      })
    )

    await store.refresh()

    // It answered, so it is reachable. Its own report says what is wrong.
    expect(store.reachable).toBe(true)
    expect(store.status).toBe('unhealthy')
    expect(store.statusMessage).toContain('connection refused')
  })

  it('retries quickly while the API is down and slowly once it is up', async () => {
    vi.useFakeTimers()
    const store = useSystemStore()
    health.mockRejectedValue(unreachable())

    store.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(health).toHaveBeenCalledTimes(1)

    // Two seconds is the whole point: it decides how long the display sits
    // showing nothing after a reboot.
    await vi.advanceTimersByTimeAsync(2000)
    expect(health).toHaveBeenCalledTimes(2)

    health.mockResolvedValue(healthy)
    await vi.advanceTimersByTimeAsync(2000)
    expect(health).toHaveBeenCalledTimes(3)

    // Now connected, it backs off.
    await vi.advanceTimersByTimeAsync(2000)
    expect(health).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(30000)
    expect(health).toHaveBeenCalledTimes(4)

    store.stopPolling()
    await vi.advanceTimersByTimeAsync(60000)
    expect(health).toHaveBeenCalledTimes(4)
  })
})
