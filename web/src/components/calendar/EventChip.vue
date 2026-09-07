<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { eventStart } from '@/utils/calendar'
import { formatTime } from '@/utils/datetime'
import type { CalendarEvent } from '@/api/types'

/**
 * An event as it appears inside a day cell.
 *
 * All-day events get a filled bar and timed ones a dot plus the start time,
 * which is the distinction that matters when scanning a month at a glance
 * from across the room.
 */
const props = withDefaults(
  defineProps<{
    event: CalendarEvent
    colour: string
    hour24?: boolean
    /** Show the time even for a compact chip. */
    showTime?: boolean
    readOnly?: boolean
  }>(),
  { hour24: true, showTime: true, readOnly: false }
)

defineEmits<{ select: [event: CalendarEvent] }>()

const time = computed(() => (props.event.allDay ? null : formatTime(eventStart(props.event), props.hour24)))
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-1.5 overflow-hidden rounded px-1.5 py-1 text-left transition-opacity hover:opacity-80 active:opacity-70"
    :style="event.allDay ? { backgroundColor: colour } : undefined"
    :title="event.title"
    @click.stop="$emit('select', event)"
  >
    <span
      v-if="!event.allDay"
      class="size-1.5 shrink-0 rounded-full"
      :style="{ backgroundColor: colour }"
      aria-hidden="true"
    />
    <span
      v-if="time && showTime"
      class="shrink-0 text-[0.6875rem] tabular-nums"
      :class="event.allDay ? 'text-white/80' : 'text-muted'"
    >
      {{ time }}
    </span>
    <span class="min-w-0 flex-1 truncate text-xs font-medium" :class="event.allDay ? 'text-white' : 'text-ink'">
      {{ event.title }}
    </span>
    <Icon
      v-if="readOnly"
      name="offline"
      :size="10"
      class="shrink-0 opacity-50"
      :class="event.allDay ? 'text-white' : 'text-faint'"
    />
  </button>
</template>
