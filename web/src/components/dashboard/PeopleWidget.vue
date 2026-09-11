<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { householdApi } from '@/api/household'
import { tasksApi } from '@/api/tasks'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import WidgetShell from './WidgetShell.vue'
import { endOfDay, formatTime, isOverdue } from '@/utils/datetime'
import { useTaskSignal } from '@/composables/useTaskSignal'
import { useSettingsStore } from '@/stores/settings'
import type { PersonDay, TaskItem } from '@/api/types'

/**
 * Everybody's day, side by side.
 *
 * The household has always been shared, which is right for a kitchen wall and
 * unhelpful for the question actually asked in front of it: not "what is on
 * today" but "what have *I* got on". One column each answers that from across
 * the room, and a task can be ticked off without going anywhere — the single
 * most common interaction this display gets.
 *
 * Columns scroll sideways rather than wrapping, so a household of seven looks
 * the same as a household of three and the widget keeps its height in both
 * orientations.
 */
const settings = useSettingsStore()

const people = ref<PersonDay[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const pending = ref<Set<string>>(new Set())

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    people.value = await householdApi.peopleToday()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the household'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const tasksElsewhere = useTaskSignal()
tasksElsewhere.onChanged(load)

async function complete(person: PersonDay, task: TaskItem): Promise<void> {
  pending.value = new Set(pending.value).add(task.id)

  try {
    const result = await tasksApi.complete(task.id)

    people.value = people.value.map(entry => {
      if (entry.name !== person.name) return entry

      const remaining = entry.tasks.filter(candidate => candidate.id !== task.id)

      // A repeating chore reappears only if its next turn is also today —
      // otherwise it correctly leaves the column until the day comes round.
      const next = result.next?.dueAt && new Date(result.next.dueAt) <= endOfDay(new Date()) ? [result.next] : []

      return { ...entry, tasks: [...remaining, ...next], doneToday: entry.doneToday + 1 }
    })

    // The task list widget may be showing the same chore.
    tasksElsewhere.announce()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not complete the task'
  } finally {
    const next = new Set(pending.value)
    next.delete(task.id)
    pending.value = next
  }
}

/** Nothing at all to say about anybody: no roster has been entered yet. */
const empty = computed(() => !loading.value && people.value.length === 0)

const outstanding = computed(() => people.value.reduce((total, person) => total + person.tasks.length, 0))
const badge = computed(() => (outstanding.value > 0 ? `${outstanding.value} to do` : null))
</script>

<template>
  <WidgetShell
    title="Today"
    icon="people"
    to="/tasks"
    class="col-span-full"
    :loading="loading"
    :error="error"
    :badge="badge"
  >
    <EmptyState
      v-if="empty"
      icon="people"
      title="Nobody listed yet"
      description="Add the people in your household in Settings → Tasks, and each of them gets a column here."
    />

    <div v-else class="fd-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      <section
        v-for="person in people"
        :key="person.name"
        class="flex w-56 shrink-0 flex-col gap-2 rounded-card border border-line bg-surface-2/40 p-3"
        :aria-label="person.name"
      >
        <header class="flex items-center gap-2 border-b border-line pb-2">
          <span class="size-2.5 shrink-0 rounded-full" :style="{ background: person.colour }" />
          <h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{{ person.name }}</h3>
          <span
            v-if="person.doneToday > 0"
            class="flex items-center gap-0.5 text-xs font-medium text-success"
            :aria-label="`${person.doneToday} done today`"
          >
            <Icon name="check" :size="13" :stroke-width="3" />{{ person.doneToday }}
          </span>
        </header>

        <ul v-if="person.events.length > 0" class="flex flex-col gap-1">
          <li v-for="event in person.events" :key="event.id" class="flex items-baseline gap-2 text-xs">
            <span class="shrink-0 tabular-nums text-muted">
              {{ event.allDay ? 'All day' : formatTime(new Date(event.startsAt), settings.clock24Hour) }}
            </span>
            <span class="min-w-0 truncate text-ink">{{ event.title }}</span>
          </li>
        </ul>

        <ul v-if="person.tasks.length > 0" class="flex flex-col">
          <li v-for="task in person.tasks" :key="task.id" class="flex items-center gap-1">
            <button
              type="button"
              class="grid size-9 shrink-0 place-items-center rounded-card transition-colors hover:bg-surface-3 active:bg-surface-3 disabled:opacity-50"
              :aria-label="`Complete ${task.title}`"
              :disabled="pending.has(task.id)"
              @click="complete(person, task)"
            >
              <span
                class="grid size-5 place-items-center rounded-full border-2 border-line-strong text-transparent transition-colors hover:border-success"
              >
                <Icon name="check" :size="12" :stroke-width="3" />
              </span>
            </button>

            <span class="min-w-0 flex-1 py-0.5">
              <span class="block truncate text-sm text-ink">{{ task.title }}</span>
              <span v-if="isOverdue(task.dueAt)" class="text-xs font-medium text-danger">Overdue</span>
            </span>
          </li>
        </ul>

        <p v-if="person.tasks.length === 0 && person.events.length === 0" class="py-2 text-xs text-faint">
          Nothing on today
        </p>

        <p v-if="person.laterCount > 0" class="mt-auto text-xs text-faint">+{{ person.laterCount }} later</p>
      </section>
    </div>
  </WidgetShell>
</template>
