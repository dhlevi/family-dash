<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Field from '@/components/ui/Field.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import TextInput from '@/components/ui/TextInput.vue'
import Toggle from '@/components/ui/Toggle.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { fromAllDayInstant, toAllDayInstant } from '@/utils/calendar'
import { addDays, formatEventSpan, fromDateInput, toDateInput, toDateTimeLocal } from '@/utils/datetime'
import {
  RECURRENCES,
  RECURRENCE_LABELS,
  type CalendarEvent,
  type CalendarSource,
  type DeleteScope,
  type NewCalendarEvent,
  type RecurrenceKind
} from '@/api/types'

/**
 * Create or edit an event.
 *
 * An event from a subscribed feed opens read-only with an explanation: the
 * next sync would overwrite any change, so offering an editable form would
 * be a lie.
 */
const props = defineProps<{
  open: boolean
  /** Null when creating. */
  event: CalendarEvent | null
  /** Pre-filled date when creating from a day cell. */
  defaultDay: Date | null
  sources: CalendarSource[]
  readOnly?: boolean
  saving?: boolean
  error?: string | null
  hour24?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [changes: NewCalendarEvent]
  remove: [event: CalendarEvent, scope: DeleteScope]
}>()

const title = ref('')
const location = ref('')
const description = ref('')
const allDay = ref(false)
const startsAt = ref('')
const endsAt = ref('')
const sourceId = ref('')
const recurrence = ref<RecurrenceKind | ''>('')
const recurrenceUntil = ref('')

const isEdit = computed(() => props.event !== null)

/**
 * Repeating is offered only for calendars this app owns.
 *
 * A writable remote calendar is pushed to one event at a time; inventing a
 * repeat rule for it would create a series upstream that could not be kept in
 * step from here. The API refuses it too, this just avoids offering it.
 */
const canRepeat = computed(() => props.sources.find(source => source.id === sourceId.value)?.type === 'local')

/** Editing any occurrence edits the series, so say so rather than surprising anyone. */
const editsWholeSeries = computed(() => isEdit.value && props.event?.seriesId !== null)

const writableSources = computed(() => props.sources.filter(source => !source.readOnly))

const sourceName = computed(
  () => props.sources.find(source => source.id === props.event?.sourceId)?.name ?? 'a subscribed calendar'
)

watch(
  () => [props.open, props.event, props.defaultDay] as const,
  ([open, event, defaultDay]) => {
    if (!open) return

    if (event) {
      title.value = event.title
      location.value = event.location ?? ''
      description.value = event.description ?? ''
      allDay.value = event.allDay
      sourceId.value = event.sourceId

      recurrence.value = event.recurrence ?? ''
      recurrenceUntil.value = event.recurrenceUntil ? toDateInput(new Date(event.recurrenceUntil)) : ''

      // A repeating event is edited as a series, so the dates shown are the
      // series' own. Showing the occurrence that was tapped would mean that
      // saving without touching anything moved the series onto that date and
      // silently dropped every occurrence before it.
      const durationMs = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()
      const shownStart = event.seriesStartsAt ?? event.startsAt
      const shownEnd = new Date(new Date(shownStart).getTime() + durationMs).toISOString()

      if (event.allDay) {
        // Stored at UTC midnight, so read as a calendar date rather than an
        // instant, or the picker opens on the previous day.
        startsAt.value = toDateInput(fromAllDayInstant(shownStart))
        // The stored end is exclusive; show the last day it actually covers.
        endsAt.value = toDateInput(addDays(fromAllDayInstant(shownEnd), -1))
      } else {
        startsAt.value = toDateTimeLocal(new Date(shownStart))
        endsAt.value = toDateTimeLocal(new Date(shownEnd))
      }
      return
    }

    // Creating: default to the tapped day at a sensible hour, an hour long.
    const base = defaultDay ? new Date(defaultDay) : new Date()
    if (!defaultDay) base.setMinutes(0, 0, 0)
    else base.setHours(new Date().getHours() + 1, 0, 0, 0)

    title.value = ''
    location.value = ''
    description.value = ''
    allDay.value = false
    recurrence.value = ''
    recurrenceUntil.value = ''
    startsAt.value = toDateTimeLocal(base)
    endsAt.value = toDateTimeLocal(new Date(base.getTime() + 60 * 60 * 1000))
    sourceId.value = writableSources.value[0]?.id ?? ''
  },
  { immediate: true }
)

/**
 * Switching the all-day toggle has to convert between the two input types,
 * or the fields end up holding a value the other input cannot show.
 */
watch(allDay, isAllDay => {
  const start = fromDateInput(startsAt.value)
  const end = fromDateInput(endsAt.value)
  if (!start) return

  if (isAllDay) {
    startsAt.value = toDateInput(start)
    endsAt.value = toDateInput(end ?? start)
  } else {
    const startWithTime = new Date(start)
    startWithTime.setHours(9, 0, 0, 0)
    startsAt.value = toDateTimeLocal(startWithTime)
    endsAt.value = toDateTimeLocal(new Date(startWithTime.getTime() + 60 * 60 * 1000))
  }
})

const recurrenceOptions = [
  { value: '' as const, label: 'Never' },
  ...RECURRENCES.map(kind => ({ value: kind, label: RECURRENCE_LABELS[kind].replace(/^Every /, '') }))
]

const validationError = computed(() => {
  if (title.value.trim().length === 0) return 'A title is required'

  const start = fromDateInput(startsAt.value)
  const end = fromDateInput(endsAt.value)
  if (!start) return 'A start is required'
  if (!end) return 'An end is required'
  if (end < start) return 'The end must not be before the start'

  return null
})

const canSave = computed(() => validationError.value === null && !props.saving && !props.readOnly)

/**
 * Whether the delete button has been tapped on a repeating event.
 *
 * Deleting one occurrence and deleting the series look identical up to the
 * moment they happen and are very different afterwards, so a repeat asks
 * which. A one-off deletes on the first tap, as it always has.
 */
const confirmingDelete = ref(false)

watch(
  () => props.open,
  open => {
    if (!open) confirmingDelete.value = false
  }
)

function requestDelete(): void {
  if (!props.event) return

  if (props.event.seriesId === null) emit('remove', props.event, 'series')
  else confirmingDelete.value = true
}

const DAY_MS = 24 * 60 * 60 * 1000

function submit(): void {
  if (!canSave.value) return

  const start = fromDateInput(startsAt.value)!
  const end = fromDateInput(endsAt.value)!
  const until = recurrenceUntil.value === '' ? null : fromDateInput(recurrenceUntil.value)

  emit('save', {
    sourceId: sourceId.value || undefined,
    title: title.value.trim(),
    location: location.value.trim() || null,
    description: description.value.trim() || null,
    // All-day events are sent as UTC midnight so they mean the same calendar
    // date everywhere, with an exclusive end matching iCalendar and the feed
    // events. Both then render through one code path.
    startsAt: allDay.value ? toAllDayInstant(start) : start.toISOString(),
    endsAt: allDay.value ? toAllDayInstant(addDays(end, 1)) : end.toISOString(),
    allDay: allDay.value,
    recurrence: recurrence.value === '' ? null : recurrence.value,
    // An end date means "the last day it runs", so the series is open until
    // the end of it rather than until its midnight.
    recurrenceUntil:
      recurrence.value === '' || until === null ? null : new Date(until.getTime() + DAY_MS - 1).toISOString()
  })
}
</script>

<template>
  <Modal
    :open="open"
    :title="readOnly ? 'Event' : isEdit ? 'Edit event' : 'New event'"
    :busy="saving"
    @close="emit('close')"
  >
    <!-- Read-only: a feed event, shown rather than offered for editing. -->
    <div v-if="readOnly && event" class="flex flex-col gap-4">
      <div>
        <h3 class="text-lg font-semibold text-ink">{{ event.title }}</h3>
        <p class="text-sm text-muted">
          {{ formatEventSpan(event.startsAt, event.endsAt, event.allDay, hour24 ?? true) }}
        </p>
      </div>

      <dl v-if="event.location || event.description" class="flex flex-col gap-2 text-sm">
        <template v-if="event.location">
          <dt class="text-faint">Where</dt>
          <dd class="fd-selectable text-ink">{{ event.location }}</dd>
        </template>
        <template v-if="event.description">
          <dt class="text-faint">Details</dt>
          <dd class="fd-selectable whitespace-pre-wrap text-ink">{{ event.description }}</dd>
        </template>
      </dl>

      <p class="flex items-start gap-2 rounded-card bg-surface-2 px-3 py-2.5 text-sm text-muted">
        <Icon name="offline" :size="18" class="mt-0.5 shrink-0 text-faint" />
        <span>
          This event comes from <strong class="font-medium text-ink">{{ sourceName }}</strong
          >. Edit it where it is published. A change here would be undone by the next sync.
        </span>
      </p>
    </div>

    <!-- Editable -->
    <div v-else class="flex flex-col gap-4">
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

      <Field label="Title" for="event-title">
        <TextInput id="event-title" v-model="title" placeholder="What's happening?" :disabled="saving" />
      </Field>

      <Toggle v-model="allDay" label="All day" :disabled="saving" />

      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" for="event-start">
          <TextInput
            id="event-start"
            v-model="startsAt"
            :type="allDay ? 'date' : 'datetime-local'"
            :disabled="saving"
          />
        </Field>

        <Field
          label="Ends"
          for="event-end"
          :hint="allDay ? 'The last day it runs' : undefined"
          :error="validationError === 'The end must not be before the start' ? validationError : null"
        >
          <TextInput
            id="event-end"
            v-model="endsAt"
            :type="allDay ? 'date' : 'datetime-local'"
            :disabled="saving"
            :invalid="validationError === 'The end must not be before the start'"
          />
        </Field>
      </div>

      <Field
        v-if="canRepeat"
        label="Repeats"
        :hint="editsWholeSeries ? 'Changes here apply to every occurrence' : undefined"
      >
        <SegmentedControl v-model="recurrence" :options="recurrenceOptions" :disabled="saving" block />
      </Field>

      <Field v-if="canRepeat && recurrence !== ''" label="Until" for="event-until" hint="Leave empty to repeat forever">
        <TextInput id="event-until" v-model="recurrenceUntil" type="date" :disabled="saving" />
      </Field>

      <Field label="Where" for="event-location">
        <TextInput id="event-location" v-model="location" placeholder="Optional" :disabled="saving" />
      </Field>

      <Field label="Details" for="event-description">
        <TextInput id="event-description" v-model="description" multiline :rows="2" :disabled="saving" />
      </Field>

      <Field v-if="writableSources.length > 1" label="Calendar">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="source in writableSources"
            :key="source.id"
            type="button"
            class="flex min-h-11 items-center gap-2 rounded-card border px-3 text-sm font-medium transition-colors"
            :class="source.id === sourceId ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted'"
            @click="sourceId = source.id"
          >
            <span class="size-3 rounded-full" :style="{ backgroundColor: source.colour }" />
            {{ source.name }}
          </button>
        </div>
      </Field>
    </div>

    <template #actions>
      <!-- A repeating event asks which, because the two are indistinguishable
           beforehand and very different afterwards. -->
      <template v-if="confirmingDelete && event">
        <ToolButton label="Keep" :disabled="saving" @click="confirmingDelete = false" />
        <span class="flex-1" />
        <ToolButton
          icon="trash"
          label="This one"
          variant="danger"
          :disabled="saving"
          @click="emit('remove', event, 'occurrence')"
        />
        <ToolButton
          icon="trash"
          label="All of them"
          variant="danger"
          :disabled="saving"
          @click="emit('remove', event, 'series')"
        />
      </template>

      <template v-else>
        <ToolButton
          v-if="event && !readOnly"
          icon="trash"
          label="Delete"
          variant="danger"
          :disabled="saving"
          @click="requestDelete"
        />
        <span class="flex-1" />
        <ToolButton :label="readOnly ? 'Close' : 'Cancel'" :disabled="saving" @click="emit('close')" />
        <ToolButton
          v-if="!readOnly"
          icon="check"
          :label="saving ? 'Saving…' : isEdit ? 'Save' : 'Add event'"
          variant="primary"
          :disabled="!canSave"
          @click="submit"
        />
      </template>
    </template>
  </Modal>
</template>
