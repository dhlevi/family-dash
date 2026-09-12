import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { systemApi } from '@/api/system'
import { ApiRequestError } from '@/api/client'
import type { HealthReport } from '@/api/types'

/**
 * Tracks whether the API is reachable and healthy.
 *
 * This is what makes an unattended wall display honest: if the API container
 * is restarting or the database has gone away, the header says so instead of
 * every widget quietly showing an empty state that looks like "no events
 * today".
 */
export const useSystemStore = defineStore('system', () => {
  const report = ref<HealthReport | null>(null)
  const reachable = ref(true)
  const lastCheckedAt = ref<Date | null>(null)
  const checking = ref(false)

  /**
   * Whether the API has answered at least once since the page loaded.
   *
   * The kiosk browser starts with the desktop session, which on a Pi is well
   * before the API has finished waiting on Postgres and running migrations.
   * Until this flips, "not reachable" means "still starting", which is worth
   * saying differently from "it broke".
   */
  const everConnected = ref(false)

  /**
   * Incremented each time the API comes back after an outage. App.vue keys
   * the routed view on it, so a recovery remounts the page and every widget
   * loads again - the same thing that happens when you switch tabs and come
   * back, which is what you would otherwise have to do by hand.
   */
  const generation = ref(0)

  let poller: ReturnType<typeof setTimeout> | undefined
  let stopped = true

  const status = computed<'ok' | 'degraded' | 'unhealthy' | 'offline'>(() => {
    if (!reachable.value) return 'offline'
    return report.value?.status ?? 'ok'
  })

  const statusLabel = computed(() => {
    switch (status.value) {
      case 'offline':
        return 'Offline'
      case 'unhealthy':
        return 'Service problem'
      case 'degraded':
        return 'Degraded'
      default:
        return 'Connected'
    }
  })

  const statusMessage = computed(() => {
    if (!reachable.value) return 'Cannot reach the dashboard service. Tap to retry.'

    const failing = (report.value?.checks ?? []).filter(check => !check.healthy)
    if (failing.length === 0) return 'All systems healthy'

    return failing.map(check => `${check.name}: ${check.message ?? 'failing'}`).join('; ')
  })

  const failingTasks = computed(() => (report.value?.tasks ?? []).filter(task => task.lastError !== null))

  async function refresh(): Promise<void> {
    const wasReachable = reachable.value
    checking.value = true

    try {
      report.value = await systemApi.health()
      reachable.value = true
    } catch (error) {
      // A network-level failure means the API is unreachable; an HTTP error
      // means it answered, so keep the last report and let its own status
      // describe the problem.
      if (error instanceof ApiRequestError && error.isNetworkError) reachable.value = false
      else reachable.value = true
    } finally {
      checking.value = false
      lastCheckedAt.value = new Date()
    }

    if (!reachable.value) return

    // A first connection needs no remount: nothing has mounted yet, because
    // the startup gate has been holding the view back. A reconnection does,
    // because everything on screen failed to load while the API was away.
    if (everConnected.value && !wasReachable) generation.value += 1
    everConnected.value = true
  }

  /**
   * Poll interval while the API is answering. Health is cheap, but this runs
   * for months on end, so there is no reason to ask more often than this.
   */
  const STEADY_INTERVAL_MS = 30000

  /**
   * And while it is not. Fast, because this is the interval that decides how
   * long a wall display sits showing errors after a reboot or a redeploy -
   * nobody is going to walk over and tap it.
   */
  const RETRY_INTERVAL_MS = 2000

  /** Begin polling. Called once from App.vue. */
  function startPolling(intervalMs = STEADY_INTERVAL_MS): void {
    if (!stopped) return
    stopped = false

    const tick = async (): Promise<void> => {
      await refresh()
      if (stopped) return
      poller = setTimeout(() => void tick(), reachable.value ? intervalMs : RETRY_INTERVAL_MS)
    }

    void tick()
  }

  function stopPolling(): void {
    stopped = true
    if (poller) clearTimeout(poller)
    poller = undefined
  }

  return {
    report,
    reachable,
    everConnected,
    generation,
    checking,
    lastCheckedAt,
    status,
    statusLabel,
    statusMessage,
    failingTasks,
    refresh,
    startPolling,
    stopPolling
  }
})
