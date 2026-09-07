<script setup lang="ts">
import { computed } from 'vue'
import EventChip from './EventChip.vue'
import { addDays, isToday, startOfWeek, toDateInput } from '@/utils/datetime'
import { colourFor, eventsByDay, isReadOnly } from '@/utils/calendar'
import type { CalendarEvent, CalendarSource } from '@/api/types'

/**
 * The week view: one column per day, events listed in order.
 *
 * Deliberately not an hour-by-hour time grid. A household calendar has a
 * handful of events a day and almost never overlapping ones, so a time grid
 * would spend most of its pixels on empty hours; columns of chips give each
 * event room for its title and time instead.
 */
const props = withDefaults(
  defineProps<{
    anchor: Date
    events: CalendarEvent[]
    sources: CalendarSource[]
    weekStartsOn?: 0 | 1
    hour24?: boolean
  }>(),
  { weekStartsOn: 0, hour24: true }
)

const emit = defineEmits<{ selectEvent: [event: CalendarEvent]; selectDay: [day: Date] }>()

const days = computed(() => {
  const first = startOfWeek(props.anchor, props.weekStartsOn)
  return Array.from({ length: 7 }, (_unused, index) => addDays(first, index))
})

const byDay = computed(() => eventsByDay(props.events, days.value))

function eventsFor(day: Date): CalendarEvent[] {
  return byDay.value.get(toDateInput(day)) ?? []
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
</script>

<template>
  <div class="grid min-h-0 flex-1 grid-cols-7">
    <div
      v-for="day in days"
      :key="day.toISOString()"
      class="flex min-h-0 min-w-0 flex-col border-r border-line last:border-r-0"
      :class="isToday(day) ? 'bg-accent-soft' : ''"
    >
      <button
        type="button"
        class="flex shrink-0 flex-col items-center gap-0.5 border-b border-line py-2 transition-colors hover:bg-surface-2"
        :aria-label="`Add an event on ${day.toDateString()}`"
        @click="emit('selectDay', day)"
      >
        <span class="text-xs font-semibold tracking-wider text-faint uppercase">
          {{ dayFormat.format(day) }}
        </span>
        <span
          class="grid size-8 place-items-center rounded-full text-base font-semibold"
          :class="isToday(day) ? 'bg-accent text-accent-ink' : 'text-ink'"
        >
          {{ day.getDate() }}
        </span>
      </button>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <!-- Empty space in a column adds an event, same as a month cell. -->
        <button
          type="button"
          class="absolute inset-0 z-0 transition-colors hover:bg-surface-2/60 active:bg-surface-3/60"
          :aria-label="`Add an event on ${day.toDateString()}`"
          @click="emit('selectDay', day)"
        />

        <div class="fd-scroll pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col gap-1 p-1.5">
          <EventChip
            v-for="event in eventsFor(day)"
            :key="`${event.id}-${toDateInput(day)}`"
            class="pointer-events-auto"
            :event="event"
            :colour="colourFor(event, sources)"
            :hour24="hour24"
            :read-only="isReadOnly(event, sources)"
            @select="emit('selectEvent', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
