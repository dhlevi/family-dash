<script setup lang="ts">
import { computed } from 'vue'
import EventChip from './EventChip.vue'
import { isToday, monthGrid, toDateInput, weekdayNames } from '@/utils/datetime'
import { colourFor, eventsByDay, isReadOnly } from '@/utils/calendar'
import type { CalendarEvent, CalendarSource } from '@/api/types'

/**
 * The month view: six whole weeks, always.
 *
 * A fixed six-week grid means the layout never jumps when moving between
 * months, which matters more on a wall display than saving a row, because
 * the eye learns where things are.
 */
const props = withDefaults(
  defineProps<{
    month: Date
    events: CalendarEvent[]
    sources: CalendarSource[]
    weekStartsOn?: 0 | 1
    hour24?: boolean
    /** Chips per cell before collapsing into a "+n more" line. */
    maxPerDay?: number
  }>(),
  { weekStartsOn: 0, hour24: true, maxPerDay: 4 }
)

const emit = defineEmits<{ selectEvent: [event: CalendarEvent]; selectDay: [day: Date] }>()

const days = computed(() => monthGrid(props.month, props.weekStartsOn))
const headings = computed(() => weekdayNames(props.weekStartsOn))
const byDay = computed(() => eventsByDay(props.events, days.value))

function eventsFor(day: Date): CalendarEvent[] {
  return byDay.value.get(toDateInput(day)) ?? []
}

function inMonth(day: Date): boolean {
  return day.getMonth() === props.month.getMonth()
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="grid shrink-0 grid-cols-7 border-b border-line">
      <div
        v-for="heading in headings"
        :key="heading"
        class="px-2 py-2 text-center text-xs font-semibold tracking-wider text-faint uppercase"
      >
        {{ heading }}
      </div>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
      <div
        v-for="day in days"
        :key="day.toISOString()"
        class="relative flex min-h-0 min-w-0 flex-col border-r border-b border-line last:border-r-0"
        :class="inMonth(day) ? 'bg-surface' : 'bg-bg'"
      >
        <!--
          The whole cell adds an event. A date-sized circle is far too fine a
          target for a finger, so this sits behind the content; the wrapper
          below is pointer-transparent and only the chips take clicks back,
          which keeps empty space tappable without stealing taps from events.
        -->
        <button
          type="button"
          class="absolute inset-0 z-0 transition-colors hover:bg-surface-2/60 active:bg-surface-3/60"
          :aria-label="`Add an event on ${day.toDateString()}`"
          @click="emit('selectDay', day)"
        />

        <div class="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col gap-0.5 p-1">
          <span
            class="grid size-6 shrink-0 place-items-center self-start rounded-full text-xs font-semibold"
            :class="[isToday(day) ? 'bg-accent text-accent-ink' : '', inMonth(day) ? 'text-ink' : 'text-faint']"
          >
            {{ day.getDate() }}
          </span>

          <div class="fd-scroll flex min-h-0 flex-1 flex-col gap-0.5">
            <EventChip
              v-for="event in eventsFor(day).slice(0, maxPerDay)"
              :key="`${event.id}-${toDateInput(day)}`"
              class="pointer-events-auto"
              :event="event"
              :colour="colourFor(event, sources)"
              :hour24="hour24"
              :read-only="isReadOnly(event, sources)"
              @select="emit('selectEvent', $event)"
            />

            <button
              v-if="eventsFor(day).length > maxPerDay"
              type="button"
              class="pointer-events-auto px-1.5 text-left text-[0.6875rem] font-medium text-accent hover:underline"
              @click="emit('selectDay', day)"
            >
              +{{ eventsFor(day).length - maxPerDay }} more
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
