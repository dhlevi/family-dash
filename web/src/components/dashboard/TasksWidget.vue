<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { tasksApi } from '@/api/tasks'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import WidgetShell from './WidgetShell.vue'
import { endOfDay, formatTime, isOverdue } from '@/utils/datetime'
import { useTaskSignal } from '@/composables/useTaskSignal'
import { useSettingsStore } from '@/stores/settings'
import type { TaskItem } from '@/api/types'

/**
 * Today's tasks, tickable from the dashboard.
 *
 * Completing something without navigating first is the point: the most
 * common interaction with a family dashboard is walking past it and marking
 * a chore done.
 */
const settings = useSettingsStore()

const tasks = ref<TaskItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const pending = ref<Set<string>>(new Set())

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    // Everything due by the end of today, which includes anything overdue.
    tasks.value = await tasksApi.list({ dueBefore: endOfDay(new Date()).toISOString(), limit: 12 })
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load tasks'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const tasksElsewhere = useTaskSignal()
tasksElsewhere.onChanged(load)

async function complete(task: TaskItem): Promise<void> {
  pending.value = new Set(pending.value).add(task.id)

  try {
    const result = await tasksApi.complete(task.id)
    tasks.value = tasks.value.filter(candidate => candidate.id !== task.id)

    // A recurring chore's next occurrence only belongs here if it is also
    // due today — otherwise it correctly disappears from this widget.
    if (result.next?.dueAt && new Date(result.next.dueAt) <= endOfDay(new Date())) {
      tasks.value = [...tasks.value, result.next]
    }

    // The per-person strip may be showing the same chore.
    tasksElsewhere.announce()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not complete the task'
  } finally {
    const next = new Set(pending.value)
    next.delete(task.id)
    pending.value = next
  }
}

const overdueCount = computed(() => tasks.value.filter(task => isOverdue(task.dueAt)).length)

const badge = computed(() => {
  if (tasks.value.length === 0) return null
  return overdueCount.value > 0 ? `${overdueCount.value} overdue` : String(tasks.value.length)
})
</script>

<template>
  <WidgetShell title="Today's tasks" icon="tasks" to="/tasks" :loading="loading" :error="error" :badge="badge">
    <EmptyState
      v-if="!loading && tasks.length === 0"
      icon="check"
      title="Nothing due today"
      description="Anything overdue would show up here too."
    />

    <ul v-else class="flex flex-col p-1.5">
      <li v-for="task in tasks" :key="task.id" class="flex items-center gap-1">
        <button
          type="button"
          class="grid size-11 shrink-0 place-items-center rounded-card transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50"
          :aria-label="`Complete ${task.title}`"
          :disabled="pending.has(task.id)"
          @click="complete(task)"
        >
          <span
            class="grid size-6 place-items-center rounded-full border-2 border-line-strong text-transparent transition-colors hover:border-success"
          >
            <Icon name="check" :size="14" :stroke-width="3" />
          </span>
        </button>

        <span class="min-w-0 flex-1 py-1">
          <span class="block truncate text-sm font-medium text-ink">{{ task.title }}</span>
          <span class="flex items-center gap-2 text-xs">
            <span v-if="isOverdue(task.dueAt)" class="font-medium text-danger">Overdue</span>
            <span v-else-if="task.dueAt" class="text-muted">
              {{ formatTime(new Date(task.dueAt), settings.clock24Hour) }}
            </span>
            <span v-if="task.assignee" class="text-faint">{{ task.assignee }}</span>
          </span>
        </span>
      </li>
    </ul>
  </WidgetShell>
</template>
