<script setup lang="ts">
import { computed } from 'vue'
import WeatherIcon from './WeatherIcon.vue'
import { formatTime } from '@/utils/datetime'
import { describeCode, formatTemperature, precipitationUnit } from '@/utils/weather'
import type { WeatherDay, WeatherUnitSystem } from '@/api/types'

/**
 * The week ahead.
 *
 * Each day gets a temperature range drawn as a bar positioned within the
 * week's overall span, so the shape of the week is readable without comparing numbers.
 */
const props = withDefaults(
  defineProps<{
    days: WeatherDay[]
    units: WeatherUnitSystem
    hour24?: boolean
  }>(),
  { hour24: true }
)

/** The week's overall range, which every day's bar is positioned against. */
const span = computed(() => {
  const lows = props.days.map(day => day.temperatureMin)
  const highs = props.days.map(day => day.temperatureMax)
  const min = Math.min(...lows)
  const max = Math.max(...highs)

  // A flat week would divide by zero; give it a nominal span instead.
  return { min, max, range: Math.max(max - min, 1) }
})

function barStyle(day: WeatherDay): Record<string, string> {
  return {
    marginLeft: `${((day.temperatureMin - span.value.min) / span.value.range) * 100}%`,
    width: `${((day.temperatureMax - day.temperatureMin) / span.value.range) * 100}%`
  }
}

/** 'YYYY-MM-DD' parsed as a local calendar day, not a UTC instant. */
function toLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, (month ?? 1) - 1, day ?? 1)
}

function dayLabel(date: string, index: number): string {
  if (index === 0) return 'Today'
  if (index === 1) return 'Tomorrow'

  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(toLocalDate(date))
}
</script>

<template>
  <ul class="flex flex-col">
    <li
      v-for="(day, index) in days"
      :key="day.date"
      class="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
    >
      <span class="w-24 shrink-0 text-sm font-medium" :class="index === 0 ? 'text-accent' : 'text-ink'">
        {{ dayLabel(day.date, index) }}
      </span>

      <WeatherIcon :code="day.code" :size="32" class="shrink-0" />

      <span class="hidden w-32 shrink-0 truncate text-xs text-muted sm:block">
        {{ describeCode(day.code) }}
      </span>

      <span
        class="flex w-16 shrink-0 items-center gap-1 text-xs tabular-nums"
        :class="day.precipitationProbability >= 30 ? 'font-medium text-info' : 'text-faint'"
      >
        {{ day.precipitationProbability }}%
        <span v-if="day.precipitationSum > 0" class="text-faint">
          {{ day.precipitationSum }}{{ precipitationUnit(units) }}
        </span>
      </span>

      <!-- Temperature range, positioned within the week's span -->
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <span class="w-8 shrink-0 text-right text-sm tabular-nums text-muted">
          {{ formatTemperature(day.temperatureMin) }}
        </span>
        <span class="h-2 min-w-0 flex-1 rounded-full bg-surface-2">
          <span class="block h-2 rounded-full bg-gradient-to-r from-info to-warn" :style="barStyle(day)" />
        </span>
        <span class="w-8 shrink-0 text-sm font-semibold tabular-nums text-ink">
          {{ formatTemperature(day.temperatureMax) }}
        </span>
      </span>

      <span v-if="day.sunrise && day.sunset" class="hidden w-28 shrink-0 text-xs text-faint lg:block">
        {{ formatTime(new Date(day.sunrise), hour24) }} – {{ formatTime(new Date(day.sunset), hour24) }}
      </span>
    </li>
  </ul>
</template>
