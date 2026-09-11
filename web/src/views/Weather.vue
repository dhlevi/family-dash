<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { weatherApi } from '@/api/weather'
import DailyForecast from '@/components/weather/DailyForecast.vue'
import HourlyStrip from '@/components/weather/HourlyStrip.vue'
import WeatherIcon from '@/components/weather/WeatherIcon.vue'
import Card from '@/components/ui/Card.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import PageShell from '@/components/ui/PageShell.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import {
  compassPoint,
  describeCode,
  formatTemperature,
  precipitationUnit,
  temperatureUnit,
  windUnit
} from '@/utils/weather'
import type { WeatherReport } from '@/api/types'

/**
 * The weather page.
 *
 * Reads the API's cache, which the background task keeps filled, so opening
 * the page is instant and a network outage shows the last forecast marked
 * stale rather than an error.
 */
const settings = useSettingsStore()

const report = ref<WeatherReport | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref<string | null>(null)

let poller: ReturnType<typeof setInterval> | undefined

async function load(quiet = false): Promise<void> {
  if (!quiet) loading.value = true
  error.value = null

  try {
    report.value = await weatherApi.report()
  } catch (caught) {
    if (!quiet) error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the forecast'
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  refreshing.value = true
  error.value = null

  try {
    report.value = await weatherApi.refresh()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not refresh the forecast'
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  if (!settings.loaded) void settings.load()
  await load()

  // The cache only changes on the API's own schedule, so polling faster than
  // this would just be traffic.
  poller = setInterval(() => void load(true), 5 * 60 * 1000)
})

onBeforeUnmount(() => {
  if (poller) clearInterval(poller)
})

const current = computed(() => report.value?.current ?? null)
const units = computed(() => report.value?.units ?? 'metric')

const today = computed(() => report.value?.daily[0] ?? null)

const observedLabel = computed(() => {
  if (!report.value) return ''

  const at = new Date(report.value.fetchedAt)
  return `${formatRelativeDay(at).toLowerCase()} at ${formatTime(at, settings.clock24Hour)}`
})
</script>

<template>
  <PageShell>
    <template #toolbar>
      <div v-if="report" class="flex min-w-0 items-baseline gap-2">
        <h2 class="truncate text-base font-semibold text-ink">{{ report.location.name }}</h2>
        <span class="truncate text-xs text-faint">{{ report.timezone }}</span>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <span v-if="report" class="hidden text-xs text-faint sm:block">
          {{ report.provider }} · updated {{ observedLabel }}
        </span>
        <ToolButton icon="refresh" label="Refresh" :disabled="refreshing" @click="refresh" />
      </div>
    </template>

    <!--
      A stale forecast is shown
    -->
    <p v-if="report?.stale" class="mb-4 flex items-center gap-2 rounded-card bg-warn/15 px-3 py-2.5 text-sm text-warn">
      <Icon name="offline" :size="18" class="shrink-0" />
      <span class="min-w-0 flex-1">
        Could not reach {{ report.provider }}. Showing the forecast from {{ observedLabel }}.
      </span>
      <button type="button" class="font-medium underline" :disabled="refreshing" @click="refresh">Try again</button>
    </p>

    <p v-if="error" class="mb-4 flex items-center gap-2 rounded-card bg-danger/15 px-3 py-2.5 text-sm text-danger">
      <Icon name="warning" :size="18" class="shrink-0" />
      {{ error }}
    </p>

    <ErrorState v-if="error && !report && !loading" :message="error" :retrying="refreshing" @retry="refresh" />

    <div v-else-if="loading && !report" class="flex flex-1 items-center justify-center py-16">
      <Spinner :size="28">Loading the forecast…</Spinner>
    </div>

    <div v-else-if="report && current" class="flex flex-col gap-4">
      <!-- Now -->
      <Card>
        <div class="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div class="flex items-center gap-4">
            <WeatherIcon :code="current.code" :is-day="current.isDay" :size="88" />
            <div>
              <p class="text-5xl leading-none font-semibold tabular-nums text-ink">
                {{ formatTemperature(current.temperature) }}
              </p>
              <p class="mt-1 text-base text-muted">{{ describeCode(current.code) }}</p>
              <p class="text-sm text-faint">Feels like {{ formatTemperature(current.feelsLike) }}</p>
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt class="text-xs text-faint">Wind</dt>
              <dd class="font-medium tabular-nums text-ink">
                {{ Math.round(current.windSpeed) }} {{ windUnit(units) }}
                <span class="text-muted">{{ compassPoint(current.windDirection) }}</span>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-faint">Humidity</dt>
              <dd class="font-medium tabular-nums text-ink">{{ current.humidity }}%</dd>
            </div>
            <div>
              <dt class="text-xs text-faint">Rain now</dt>
              <dd class="font-medium tabular-nums text-ink">
                {{ current.precipitation }}{{ precipitationUnit(units) }}
              </dd>
            </div>
            <div v-if="today">
              <dt class="text-xs text-faint">Today</dt>
              <dd class="font-medium tabular-nums text-ink">
                {{ formatTemperature(today.temperatureMin) }} –
                {{ formatTemperature(today.temperatureMax) }}
              </dd>
            </div>
          </dl>

          <div v-if="today?.sunrise && today?.sunset" class="flex items-center gap-4 text-sm text-muted">
            <span class="flex items-center gap-1.5">
              <Icon name="weather" :size="16" class="text-warn" />
              {{ formatTime(new Date(today.sunrise), settings.clock24Hour) }}
            </span>
            <span class="flex items-center gap-1.5">
              <Icon name="weather" :size="16" class="text-faint" />
              {{ formatTime(new Date(today.sunset), settings.clock24Hour) }}
            </span>
          </div>
        </div>
      </Card>

      <!-- Next 24 hours -->
      <Card :padded="false">
        <h3 class="border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wider text-muted uppercase">
          Next 24 hours
        </h3>
        <div class="px-3 py-2">
          <HourlyStrip :hours="report.hourly" :hour24="settings.clock24Hour" :count="24" />
        </div>
      </Card>

      <!-- The week -->
      <Card :padded="false">
        <h3 class="border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wider text-muted uppercase">
          The week ahead
        </h3>
        <div class="px-4">
          <DailyForecast :days="report.daily" :units="units" :hour24="settings.clock24Hour" />
        </div>
      </Card>

      <p class="pb-2 text-center text-xs text-faint">
        Temperatures in {{ temperatureUnit(units) }} · change the location and units in Settings
      </p>
    </div>
  </PageShell>
</template>
