<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import { formatEventSpan, formatRelativeDay, isToday } from '@/utils/datetime'
import { agendaDays, colourFor, isReadOnly } from '@/utils/calendar'
import type { CalendarEvent, CalendarSource } from '@/api/types'

/**
 * A chronological list grouped by day, skipping empty days.
 *
 * This is the view that answers "what's coming up" without any spatial
 * reasoning, so it is the most readable of the three at a distance and the
 * best fit for a narrow portrait screen.
 */
const props = withDefaults(
  defineProps<{
    from: Date
    to: Date
    events: CalendarEvent[]
    sources: CalendarSource[]
    hour24?: boolean
  }>(),
  { hour24: true }
)

const emit = defineEmits<{ selectEvent: [event: CalendarEvent] }>()

const groups = computed(() => agendaDays(props.events, props.from, props.to))

function sourceName(event: CalendarEvent): string | null {
  return props.sources.find(source => source.id === event.sourceId)?.name ?? null
}
</script>

<template>
  <div v-if="groups.length === 0" class="flex min-h-0 flex-1">
    <EmptyState
      icon="calendar"
      title="Nothing in this range"
      description="Tap a day in the month view, or add an event, to fill it in."
    />
  </div>

  <div v-else class="fd-scroll min-h-0 flex-1">
    <section v-for="group in groups" :key="group.day.toISOString()" class="border-b border-line last:border-b-0">
      <h3
        class="sticky top-0 z-10 flex items-baseline gap-2 bg-bg/95 px-4 py-2 text-sm font-semibold backdrop-blur"
        :class="isToday(group.day) ? 'text-accent' : 'text-muted'"
      >
        {{ formatRelativeDay(group.day) }}
        <span class="text-xs font-normal text-faint">
          {{ group.day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }}
        </span>
      </h3>

      <ul class="flex flex-col">
        <li v-for="event in group.events" :key="event.id">
          <button
            type="button"
            class="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-3"
            @click="emit('selectEvent', event)"
          >
            <span
              class="h-10 w-1 shrink-0 rounded-full"
              :style="{ backgroundColor: colourFor(event, sources) }"
              aria-hidden="true"
            />

            <span class="min-w-0 flex-1">
              <span class="block truncate text-base font-medium text-ink">{{ event.title }}</span>
              <span class="flex flex-wrap items-center gap-x-3 text-xs text-muted">
                <span>{{ formatEventSpan(event.startsAt, event.endsAt, event.allDay, hour24) }}</span>
                <span v-if="event.location" class="truncate">{{ event.location }}</span>
                <span v-if="sourceName(event)" class="text-faint">{{ sourceName(event) }}</span>
              </span>
            </span>

            <Icon
              v-if="isReadOnly(event, sources)"
              name="offline"
              :size="14"
              class="shrink-0 text-faint"
              title="From a subscribed calendar"
            />
            <Icon v-else name="chevronRight" :size="18" class="shrink-0 text-faint" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
