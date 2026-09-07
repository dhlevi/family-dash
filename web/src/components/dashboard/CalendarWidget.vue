<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { calendarApi } from '@/api/calendar'
import EmptyState from '@/components/ui/EmptyState.vue'
import WidgetShell from './WidgetShell.vue'
import { colourFor, eventStart } from '@/utils/calendar'
import { formatRelativeDay, formatTime, isSameDay } from '@/utils/datetime'
import { useSettingsStore } from '@/stores/settings'
import type { CalendarEvent, CalendarSource } from '@/api/types'

/**
 * "Up next": the events coming in the configured window.
 *
 * Grouped by day with the day named once, so the list reads as
 * "Today · 19:00 Swim lessons" rather than repeating a date on every line.
 */
const settings = useSettingsStore()

const events = ref<CalendarEvent[]>([])
const sources = ref<CalendarSource[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [upcoming, fetchedSources] = await Promise.all([calendarApi.upcoming(10), calendarApi.sources()])
    events.value = upcoming
    sources.value = fetchedSources
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load events'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** Consecutive events on the same day share one heading. */
const grouped = computed(() => {
  const groups: Array<{ day: Date; events: CalendarEvent[] }> = []

  for (const event of events.value) {
    const day = eventStart(event)
    const last = groups.at(-1)

    if (last && isSameDay(last.day, day)) last.events.push(event)
    else groups.push({ day, events: [event] })
  }

  return groups
})

const badge = computed(() => (events.value.length > 0 ? String(events.value.length) : null))
</script>

<template>
  <WidgetShell title="Up next" icon="calendar" to="/calendar" :loading="loading" :error="error" :badge="badge">
    <EmptyState
      v-if="!loading && events.length === 0"
      icon="calendar"
      title="Nothing coming up"
      description="Add an event, or subscribe to a calendar in Settings."
    />

    <div v-else class="flex flex-col gap-3 p-3">
      <section v-for="group in grouped" :key="group.day.toISOString()" class="flex flex-col gap-1">
        <h3 class="text-xs font-semibold tracking-wider text-faint uppercase">
          {{ formatRelativeDay(group.day) }}
        </h3>

        <ul class="flex flex-col gap-1">
          <li v-for="event in group.events" :key="event.id" class="flex items-center gap-2.5">
            <span
              class="h-8 w-1 shrink-0 rounded-full"
              :style="{ backgroundColor: colourFor(event, sources) }"
              aria-hidden="true"
            />
            <span class="w-12 shrink-0 text-xs tabular-nums" :class="event.allDay ? 'text-faint' : 'text-muted'">
              {{ event.allDay ? 'All day' : formatTime(eventStart(event), settings.clock24Hour) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-ink">{{ event.title }}</span>
              <span v-if="event.location" class="block truncate text-xs text-faint">{{ event.location }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </WidgetShell>
</template>
