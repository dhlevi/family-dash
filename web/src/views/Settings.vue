<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { systemApi } from '@/api/system'
import { ApiRequestError } from '@/api/client'
import Card from '@/components/ui/Card.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import PageShell from '@/components/ui/PageShell.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSystemStore } from '@/stores/system'
import type { SystemInfo } from '@/api/types'

/**
 * Settings.
 *
 * This pass covers the diagnostics half — service status, health probes and
 * background tasks — which is what you need on hand when the Pi is behaving
 * oddly and there is no terminal nearby. The preference editors (location,
 * theme, dashboard widgets, calendar sources, feeds, API keys) land with the
 * settings store in the next pass.
 */
const system = useSystemStore()

const info = ref<SystemInfo | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [systemInfo] = await Promise.all([systemApi.info(), system.refresh()])
    info.value = systemInfo
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load service information'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const checks = computed(() => system.report?.checks ?? [])
const tasks = computed(() => system.report?.tasks ?? [])

const uptime = computed(() => {
  const seconds = info.value?.uptimeSeconds ?? 0
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
})

const statusTone = computed(() => {
  switch (system.status) {
    case 'ok':
      return 'text-success'
    case 'degraded':
      return 'text-warn'
    default:
      return 'text-danger'
  }
})

function formatWhen(value: string | null): string {
  if (!value) return 'never'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <PageShell>
    <template #toolbar>
      <ToolButton icon="refresh" label="Refresh" :disabled="loading" @click="load" />
      <span class="ml-auto text-sm text-faint">
        Preferences arrive with the next pass; this page currently reports service state.
      </span>
    </template>

    <ErrorState v-if="error" :message="error" :retrying="loading" @retry="load" />

    <div v-else-if="loading && !info" class="flex flex-1 items-center justify-center py-16">
      <Spinner :size="28">Loading service information…</Spinner>
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(21rem,1fr))] items-start gap-4">
      <!-- Service -->
      <Card>
        <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
          <Icon name="settings" :size="18" />
          Service
        </h2>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-faint">Status</dt>
          <dd class="font-medium" :class="statusTone">{{ system.statusLabel }}</dd>

          <dt class="text-faint">Version</dt>
          <dd class="fd-selectable text-ink">{{ info?.version }}</dd>

          <dt class="text-faint">Environment</dt>
          <dd class="text-ink">{{ info?.environment }}</dd>

          <dt class="text-faint">Platform</dt>
          <dd class="fd-selectable text-ink">{{ info?.platform }}</dd>

          <dt class="text-faint">Node</dt>
          <dd class="text-ink">{{ info?.node }}</dd>

          <dt class="text-faint">Timezone</dt>
          <dd class="text-ink">{{ info?.timezone }}</dd>

          <dt class="text-faint">Uptime</dt>
          <dd class="text-ink">{{ uptime }}</dd>

          <dt class="text-faint">Routes</dt>
          <dd class="text-ink">{{ info?.routes }}</dd>
        </dl>

        <a
          href="/openapi"
          target="_blank"
          rel="noopener"
          class="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          Browse the API documentation
          <Icon name="chevronRight" :size="16" />
        </a>
      </Card>

      <!-- Health probes -->
      <Card>
        <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
          <Icon name="check" :size="18" />
          Health checks
        </h2>

        <ul class="flex flex-col gap-2">
          <li
            v-for="check in checks"
            :key="check.name"
            class="flex items-start gap-3 rounded-card bg-surface-2 px-3 py-2.5"
          >
            <span
              class="mt-1.5 size-2.5 shrink-0 rounded-full"
              :class="check.healthy ? 'bg-success' : check.critical ? 'bg-danger' : 'bg-warn'"
              :aria-label="check.healthy ? 'healthy' : 'failing'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink">
                {{ check.name }}
                <span v-if="!check.critical" class="text-xs font-normal text-faint">(non-critical)</span>
              </p>
              <p v-if="check.message" class="text-xs text-warn">{{ check.message }}</p>
              <p v-else class="text-xs text-faint">Responded in {{ check.durationMs }}ms</p>
            </div>
          </li>
        </ul>
      </Card>

      <!-- Background tasks -->
      <Card>
        <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
          <Icon name="clock" :size="18" />
          Background refresh
        </h2>

        <p v-if="tasks.length === 0" class="text-sm text-faint">
          No background tasks are registered yet. Calendar, news, weather and photo scanning register their own
          schedules as those features land.
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li v-for="task in tasks" :key="task.name" class="rounded-card bg-surface-2 px-3 py-2.5">
            <div class="flex items-center gap-2">
              <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ task.name }}</p>
              <code class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-muted">{{ task.cron }}</code>
              <ToolButton
                icon="refresh"
                :label="`Run ${task.name} now`"
                icon-only
                :disabled="task.running"
                @click="systemApi.runTask(task.name).then(() => system.refresh())"
              />
            </div>
            <p class="mt-1 text-xs" :class="task.lastError ? 'text-danger' : 'text-faint'">
              {{ task.lastError ?? `Last run ${formatWhen(task.lastRunAt)}` }}
            </p>
          </li>
        </ul>
      </Card>
    </div>
  </PageShell>
</template>
