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

  let poller: ReturnType<typeof setInterval> | undefined

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
  }

  /** Begin polling. Called once from App.vue. */
  function startPolling(intervalMs = 30000): void {
    if (poller) return
    void refresh()
    poller = setInterval(() => void refresh(), intervalMs)
  }

  function stopPolling(): void {
    if (!poller) return
    clearInterval(poller)
    poller = undefined
  }

  return {
    report,
    reachable,
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
