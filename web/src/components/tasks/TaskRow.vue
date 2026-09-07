<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { formatDueLabel, isOverdue } from '@/utils/datetime'
import { RECURRENCE_LABELS, type RecurrenceKind, type TaskItem } from '@/api/types'

/**
 * One task in a list.
 *
 * The checkbox is a deliberately oversized target, separate from the row
 * itself — ticking something off is the common action and must not risk
 * opening the editor by mistake.
 */
const props = defineProps<{
  task: TaskItem
  hour24?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ toggle: [task: TaskItem]; edit: [task: TaskItem] }>()

const done = computed(() => props.task.completedAt !== null)
const overdue = computed(() => !done.value && isOverdue(props.task.dueAt))

const dueLabel = computed(() =>
  props.task.dueAt ? formatDueLabel(props.task.dueAt, { hour24: props.hour24 ?? true }) : null
)

const recurrenceLabel = computed(() =>
  props.task.recurrence && props.task.recurrence in RECURRENCE_LABELS
    ? RECURRENCE_LABELS[props.task.recurrence as RecurrenceKind]
    : null
)

/** Only high and urgent earn a marker; flagging everything flags nothing. */
const priorityTone = computed(() => {
  if (done.value) return null
  if (props.task.priority >= 3) return 'bg-danger'
  if (props.task.priority === 2) return 'bg-warn'
  return null
})
</script>

<template>
  <li class="flex items-stretch gap-1 rounded-card border border-line bg-surface">
    <button
      type="button"
      class="grid w-14 shrink-0 place-items-center rounded-l-card transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50"
      :aria-label="done ? `Reopen ${task.title}` : `Complete ${task.title}`"
      :disabled="busy"
      @click="emit('toggle', task)"
    >
      <span
        class="grid size-7 place-items-center rounded-full border-2 transition-colors"
        :class="done ? 'border-success bg-success text-white' : 'border-line-strong text-transparent'"
      >
        <Icon name="check" :size="16" :stroke-width="3" />
      </span>
    </button>

    <button
      type="button"
      class="flex min-h-touch min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-3"
      @click="emit('edit', task)"
    >
      <span v-if="priorityTone" class="h-8 w-1 shrink-0 rounded-full" :class="priorityTone" aria-hidden="true" />

      <span class="min-w-0 flex-1">
        <span class="block truncate text-base font-medium" :class="done ? 'text-faint line-through' : 'text-ink'">
          {{ task.title }}
        </span>

        <span class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span v-if="dueLabel" :class="overdue ? 'font-medium text-danger' : 'text-muted'">
            {{ overdue ? `Overdue · ${dueLabel}` : dueLabel }}
          </span>
          <span v-if="recurrenceLabel" class="flex items-center gap-1 text-faint">
            <Icon name="refresh" :size="12" />
            {{ recurrenceLabel }}
          </span>
          <span v-if="task.notes" class="truncate text-faint">{{ task.notes }}</span>
        </span>
      </span>

      <span
        v-if="task.assignee"
        class="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
      >
        {{ task.assignee }}
      </span>
      <span v-if="task.category" class="shrink-0 rounded-full bg-surface-3 px-2.5 py-1 text-xs text-muted">
        {{ task.category }}
      </span>
    </button>
  </li>
</template>
