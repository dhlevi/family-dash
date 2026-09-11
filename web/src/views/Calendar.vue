<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { calendarApi } from '@/api/calendar'
import AgendaList from '@/components/calendar/AgendaList.vue'
import EventEditor from '@/components/calendar/EventEditor.vue'
import MonthGrid from '@/components/calendar/MonthGrid.vue'
import WeekColumns from '@/components/calendar/WeekColumns.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import { addDays, addMonths, endOfMonth, formatMonthYear, startOfMonth, startOfWeek } from '@/utils/datetime'
import { isReadOnly } from '@/utils/calendar'
import type { CalendarEvent, CalendarSource, DeleteScope, NewCalendarEvent } from '@/api/types'

/**
 * The calendar page.
 *
 * Events come from the API's local cache, which the background sync keeps
 * filled so switching months is instant and the page keeps working when a
 * feed or the network is down. Only the local family calendar is writable;
 * subscribed events open read-only.
 */
type View = 'month' | 'week' | 'agenda'

const settings = useSettingsStore()

const view = ref<View>('month')
/** The date the current view is centred on. */
const anchor = ref(new Date())

const events = ref<CalendarEvent[]>([])
const sources = ref<CalendarSource[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const editorOpen = ref(false)
const editing = ref<CalendarEvent | null>(null)
const defaultDay = ref<Date | null>(null)
const saving = ref(false)
const editorError = ref<string | null>(null)
const syncing = ref(false)

/** The span to fetch: a padded month, the week, or the next six weeks. */
const range = computed<{ from: Date; to: Date }>(() => {
  if (view.value === 'week') {
    const from = startOfWeek(anchor.value, settings.weekStartsOn)
    return { from, to: addDays(from, 7) }
  }

  if (view.value === 'agenda') {
    return { from: new Date(anchor.value), to: addDays(anchor.value, 42) }
  }

  // Month: pad by a week either side so the grid's leading and trailing days
  // are populated too.
  return { from: addDays(startOfMonth(anchor.value), -7), to: addDays(endOfMonth(anchor.value), 7) }
})

const heading = computed(() => {
  if (view.value === 'week') {
    const from = startOfWeek(anchor.value, settings.weekStartsOn)
    const to = addDays(from, 6)
    const sameMonth = from.getMonth() === to.getMonth()

    return sameMonth
      ? `${from.getDate()}–${to.getDate()} ${formatMonthYear(from)}`
      : `${from.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${to.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
  }

  if (view.value === 'agenda') return 'Next six weeks'

  return formatMonthYear(anchor.value)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [fetchedEvents, fetchedSources] = await Promise.all([
      calendarApi.events(range.value.from, range.value.to),
      sources.value.length === 0 ? calendarApi.sources() : Promise.resolve(sources.value)
    ])

    events.value = fetchedEvents
    sources.value = fetchedSources
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the calendar'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  view.value = settings.get('calendar.defaultView', 'month')
  await load()
})

// Any change of view or anchor changes the range that needs fetching.
watch([view, anchor], load)

// --- navigation -------------------------------------------------------------

function step(direction: 1 | -1): void {
  if (view.value === 'week') anchor.value = addDays(anchor.value, direction * 7)
  else if (view.value === 'agenda') anchor.value = addDays(anchor.value, direction * 42)
  else anchor.value = addMonths(anchor.value, direction)
}

function today(): void {
  anchor.value = new Date()
}

// --- editing ----------------------------------------------------------------

function openEvent(event: CalendarEvent): void {
  editing.value = event
  defaultDay.value = null
  editorError.value = null
  editorOpen.value = true
}

function openDay(day: Date): void {
  editing.value = null
  defaultDay.value = day
  editorError.value = null
  editorOpen.value = true
}

function openNew(): void {
  openDay(new Date())
}

const editingReadOnly = computed(() => editing.value !== null && isReadOnly(editing.value, sources.value))

async function save(changes: NewCalendarEvent): Promise<void> {
  saving.value = true
  editorError.value = null

  try {
    if (editing.value) {
      const updated = await calendarApi.updateEvent(editing.value.id, changes)
      events.value = events.value.map(candidate => (candidate.id === updated.id ? updated : candidate))
    } else {
      const created = await calendarApi.addEvent(changes)
      // Only keep it in view if it actually falls inside the loaded range.
      const start = new Date(created.startsAt)
      if (start >= range.value.from && start < range.value.to) events.value = [...events.value, created]
    }

    editorOpen.value = false
  } catch (caught) {
    editorError.value = caught instanceof ApiRequestError ? describeError(caught) : 'Could not save the event'
  } finally {
    saving.value = false
  }
}

async function remove(event: CalendarEvent, scope: DeleteScope): Promise<void> {
  saving.value = true
  try {
    await calendarApi.deleteEvent(event.id, scope)

    // Reloading rather than filtering: deleting a series takes every one of
    // its occurrences with it, and they do not share an id to filter on.
    if (event.seriesId !== null) await load()
    else events.value = events.value.filter(candidate => candidate.id !== event.id)

    editorOpen.value = false
  } catch (caught) {
    editorError.value = caught instanceof ApiRequestError ? caught.message : 'Could not delete the event'
  } finally {
    saving.value = false
  }
}

async function syncNow(): Promise<void> {
  syncing.value = true
  try {
    const outcomes = await calendarApi.syncAll()
    const failed = outcomes.filter(outcome => outcome.error !== null)

    error.value =
      failed.length > 0
        ? `${failed.length} calendar(s) failed to sync: ${failed.map(f => `${f.name} (${f.error})`).join('; ')}`
        : null

    sources.value = await calendarApi.sources()
    await load()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not sync calendars'
  } finally {
    syncing.value = false
  }
}

function describeError(caught: ApiRequestError): string {
  const details = caught.details
  if (Array.isArray(details)) {
    return details.map(issue => (issue as { message?: string }).message ?? String(issue)).join('; ')
  }
  return caught.message
}

const viewOptions = [
  { value: 'month' as const, label: 'Month' },
  { value: 'week' as const, label: 'Week' },
  { value: 'agenda' as const, label: 'Agenda' }
]

const enabledSources = computed(() => sources.value.filter(source => source.enabled))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Toolbar -->
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-4 py-3">
      <div class="flex items-center gap-1">
        <ToolButton icon="chevronLeft" label="Previous" icon-only @click="step(-1)" />
        <ToolButton label="Today" @click="today" />
        <ToolButton icon="chevronRight" label="Next" icon-only @click="step(1)" />
      </div>

      <h2 class="min-w-0 flex-1 truncate px-1 text-lg font-semibold text-ink">{{ heading }}</h2>

      <SegmentedControl v-model="view" :options="viewOptions" />

      <ToolButton icon="refresh" label="Sync" icon-only :disabled="syncing" @click="syncNow" />
      <ToolButton icon="plus" label="Add event" variant="primary" @click="openNew" />
    </div>

    <!-- Source legend -->
    <div
      v-if="enabledSources.length > 1"
      class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2"
    >
      <span v-for="source in enabledSources" :key="source.id" class="flex items-center gap-1.5 text-xs text-muted">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: source.colour }" />
        {{ source.name }}
        <Icon v-if="source.lastError" name="warning" :size="12" class="text-warn" :title="source.lastError" />
      </span>
    </div>

    <p
      v-if="error"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/10 px-4 py-2 text-sm text-danger"
    >
      <Icon name="warning" :size="16" />
      <span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="font-medium underline" @click="load">Retry</button>
    </p>

    <!-- Body -->
    <ErrorState v-if="error && events.length === 0 && !loading" :message="error" :retrying="loading" @retry="load" />

    <div v-else-if="loading && events.length === 0" class="flex flex-1 items-center justify-center">
      <Spinner :size="28">Loading calendar…</Spinner>
    </div>

    <MonthGrid
      v-else-if="view === 'month'"
      :month="anchor"
      :events="events"
      :sources="sources"
      :week-starts-on="settings.weekStartsOn"
      :hour24="settings.clock24Hour"
      @select-event="openEvent"
      @select-day="openDay"
    />

    <WeekColumns
      v-else-if="view === 'week'"
      :anchor="anchor"
      :events="events"
      :sources="sources"
      :week-starts-on="settings.weekStartsOn"
      :hour24="settings.clock24Hour"
      @select-event="openEvent"
      @select-day="openDay"
    />

    <AgendaList
      v-else
      :from="range.from"
      :to="range.to"
      :events="events"
      :sources="sources"
      :hour24="settings.clock24Hour"
      @select-event="openEvent"
    />

    <EventEditor
      :open="editorOpen"
      :event="editing"
      :default-day="defaultDay"
      :sources="sources"
      :read-only="editingReadOnly"
      :saving="saving"
      :error="editorError"
      :hour24="settings.clock24Hour"
      @close="editorOpen = false"
      @save="save"
      @remove="remove"
    />
  </div>
</template>
