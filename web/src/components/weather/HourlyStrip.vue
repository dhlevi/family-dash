<script setup lang="ts">
import { computed } from 'vue'
import WeatherIcon from './WeatherIcon.vue'
import { formatTime, isSameDay } from '@/utils/datetime'
import { formatTemperature } from '@/utils/weather'
import type { WeatherHour } from '@/api/types'

/**
 * The next day or so, hour by hour.
 *
 * The API returns the whole forecast window starting at local midnight,
 * including hours already gone. Those are dropped here: nobody looking at a
 * kitchen wall wants to know what the weather was at 3am.
 */
const props = withDefaults(
  defineProps<{
    hours: WeatherHour[]
    hour24?: boolean
    /** How many hours forward to show. */
    count?: number
  }>(),
  { hour24: true, count: 24 }
)

const upcoming = computed(() => {
  const now = Date.now()

  // The hour in progress is still useful, so the cutoff is the start of the
  // current hour rather than the exact moment.
  const cutoff = now - 60 * 60 * 1000

  return props.hours.filter(hour => Date.parse(hour.time) >= cutoff).slice(0, props.count)
})

/** Scale the rain bars against the wettest hour on show, with a floor. */
const peakProbability = computed(() => Math.max(10, ...upcoming.value.map(hour => hour.precipitationProbability)))

function label(hour: WeatherHour): string {
  const date = new Date(hour.time)
  const now = new Date()

  return isSameDay(date, now)
    ? formatTime(date, props.hour24)
    : `${new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)} ${formatTime(date, props.hour24)}`
}
</script>

<template>
  <div class="fd-scroll-x flex gap-1 pb-1">
    <div
      v-for="hour in upcoming"
      :key="hour.time"
      class="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-card py-2"
    >
      <span class="text-xs whitespace-nowrap text-muted">{{ label(hour) }}</span>
      <WeatherIcon :code="hour.code" :is-day="hour.isDay" :size="32" />
      <span class="text-sm font-semibold tabular-nums text-ink">
        {{ formatTemperature(hour.temperature) }}
      </span>

      <!-- Rain chance as a bar plus a number: the bar is what reads from
           across a room, the number is for when you actually care. -->
      <span class="flex h-8 w-full flex-col items-center justify-end gap-0.5">
        <span
          v-if="hour.precipitationProbability > 0"
          class="w-2 rounded-full bg-info"
          :style="{ height: `${Math.max(2, (hour.precipitationProbability / peakProbability) * 20)}px` }"
        />
        <span
          class="text-[0.625rem] tabular-nums"
          :class="hour.precipitationProbability >= 30 ? 'font-medium text-info' : 'text-faint'"
        >
          {{ hour.precipitationProbability > 0 ? `${hour.precipitationProbability}%` : '-' }}
        </span>
      </span>
    </div>
  </div>
</template>
