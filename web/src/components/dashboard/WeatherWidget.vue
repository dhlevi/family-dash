<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { weatherApi } from '@/api/weather'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import WeatherIcon from '@/components/weather/WeatherIcon.vue'
import WidgetShell from './WidgetShell.vue'
import { formatTime } from '@/utils/datetime'
import { describeCode, formatTemperature } from '@/utils/weather'
import { useSettingsStore } from '@/stores/settings'
import type { WeatherReport } from '@/api/types'

/**
 * Current conditions plus the next few hours.
 *
 * The question this answers from across a kitchen is "do I need a coat", so
 * the temperature and the icon get the space, and the next few hours are
 * there to answer "will it rain before we leave".
 */
const settings = useSettingsStore()

const report = ref<WeatherReport | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    report.value = await weatherApi.report()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the forecast'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** The next four hours, skipping any already gone. */
const nextHours = computed(() => {
  if (!report.value) return []

  const cutoff = Date.now() - 60 * 60 * 1000
  return report.value.hourly.filter(hour => Date.parse(hour.time) >= cutoff).slice(0, 4)
})

const today = computed(() => report.value?.daily[0] ?? null)

const badge = computed(() => (report.value?.stale ? 'cached' : null))
</script>

<template>
  <WidgetShell
    :title="report?.location.name ?? 'Weather'"
    icon="weather"
    to="/weather"
    :loading="loading"
    :error="error"
    :badge="badge"
  >
    <EmptyState
      v-if="!loading && !report"
      icon="weather"
      title="No forecast yet"
      description="Set your location in Settings. Open-Meteo needs no API key."
    />

    <div v-else-if="report" class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div style="height: 250px; margin-left: 110px" class="flex items-center gap-3">
        <WeatherIcon :code="report.current.code" :is-day="report.current.isDay" :size="64" />
        <div class="min-w-0">
          <p class="text-3xl leading-none font-semibold tabular-nums text-ink">
            {{ formatTemperature(report.current.temperature) }}
          </p>
          <p class="mt-0.5 truncate text-sm text-muted">{{ describeCode(report.current.code) }}</p>
          <p v-if="today" class="text-xs text-faint tabular-nums">
            {{ formatTemperature(today.temperatureMin) }} –
            {{ formatTemperature(today.temperatureMax) }}
            <span v-if="today.precipitationProbability >= 20" class="text-info">
              · {{ today.precipitationProbability }}% rain
            </span>
          </p>
        </div>
      </div>

      <ul v-if="nextHours.length > 0" class="mt-auto flex justify-between gap-1">
        <li v-for="hour in nextHours" :key="hour.time" class="flex flex-col items-center gap-0.5">
          <span class="text-[0.6875rem] text-faint">
            {{ formatTime(new Date(hour.time), settings.clock24Hour) }}
          </span>
          <WeatherIcon :code="hour.code" :is-day="hour.isDay" :size="26" />
          <span class="text-xs font-medium tabular-nums text-ink">
            {{ formatTemperature(hour.temperature) }}
          </span>
        </li>
      </ul>

      <p v-if="report.stale" class="flex items-center gap-1.5 text-xs text-warn">
        <Icon name="offline" :size="14" />
        Cached — could not reach {{ report.provider }}
      </p>
    </div>
  </WidgetShell>
</template>
