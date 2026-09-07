<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { tasksApi } from '@/api/tasks'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import PageShell from '@/components/ui/PageShell.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import TaskEditor from '@/components/tasks/TaskEditor.vue'
import TaskRow from '@/components/tasks/TaskRow.vue'
import { useSettingsStore } from '@/stores/settings'
import { daysBetween, isOverdue } from '@/utils/datetime'
import type { NewTaskItem, TaskItem } from '@/api/types'

/**
 * Tasks and chores.
 *
 * Grouped by when something is due rather than shown as one flat list: the
 * question being asked of a family dashboard is almost always "what needs
 * doing today", and a chronological list answers it without any filtering.
 */
const settings = useSettingsStore()

const tasks = ref<TaskItem[]>([])
const assignees = ref<string[]>([])
const categories = ref<string[]>([])

const loading = ref(true)
const error = ref<string | null>(null)
/** Ids with an in-flight request, so individual rows can show as busy. */
const pending = ref<Set<string>>(new Set())

const showCompleted = ref(false)
const assigneeFilter = ref('')
const search = ref('')

const quickAdd = ref('')
const adding = ref(false)

const editorOpen = ref(false)
const editing = ref<TaskItem | null>(null)
const saving = ref(false)
const editorError = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [list, suggestions] = await Promise.all([
      tasksApi.list({
        includeCompleted: showCompleted.value,
        assignee: assigneeFilter.value || undefined,
        search: search.value.trim() || undefined
      }),
      tasksApi.suggestions()
    ])

    tasks.value = list
    assignees.value = suggestions.assignees
    categories.value = suggestions.categories
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load tasks'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  showCompleted.value = settings.showCompletedTasks
  await load()
})

// --- grouping ---------------------------------------------------------------

interface Group {
  key: string
  label: string
  tone: string
  tasks: TaskItem[]
}

const groups = computed<Group[]>(() => {
  const now = new Date()
  const buckets: Record<string, TaskItem[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    undated: [],
    done: []
  }

  for (const task of tasks.value) {
    if (task.completedAt !== null) {
      buckets.done!.push(task)
      continue
    }
    if (task.dueAt === null) {
      buckets.undated!.push(task)
      continue
    }

    const days = daysBetween(now, new Date(task.dueAt))

    if (isOverdue(task.dueAt, now)) buckets.overdue!.push(task)
    else if (days === 0) buckets.today!.push(task)
    else if (days <= 7) buckets.week!.push(task)
    else buckets.later!.push(task)
  }

  return [
    { key: 'overdue', label: 'Overdue', tone: 'text-danger', tasks: buckets.overdue! },
    { key: 'today', label: 'Today', tone: 'text-accent', tasks: buckets.today! },
    { key: 'week', label: 'This week', tone: 'text-muted', tasks: buckets.week! },
    { key: 'later', label: 'Later', tone: 'text-muted', tasks: buckets.later! },
    { key: 'undated', label: 'No date', tone: 'text-muted', tasks: buckets.undated! },
    { key: 'done', label: 'Completed', tone: 'text-faint', tasks: buckets.done! }
  ].filter(group => group.tasks.length > 0)
})

const openCount = computed(() => tasks.value.filter(task => task.completedAt === null).length)

// --- actions ----------------------------------------------------------------

async function addQuick(): Promise<void> {
  const title = quickAdd.value.trim()
  if (title.length === 0 || adding.value) return

  adding.value = true
  try {
    const created = await tasksApi.add({ title, assignee: assigneeFilter.value || null })
    // Prepend rather than reload: the list regroups itself and the field
    // stays ready for the next one.
    tasks.value = [created, ...tasks.value]
    quickAdd.value = ''
    if (created.assignee && !assignees.value.includes(created.assignee)) {
      assignees.value = [...assignees.value, created.assignee].sort((a, b) => a.localeCompare(b))
    }
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not add the task'
  } finally {
    adding.value = false
  }
}

async function toggle(task: TaskItem): Promise<void> {
  pending.value = new Set(pending.value).add(task.id)

  try {
    if (task.completedAt === null) {
      const result = await tasksApi.complete(task.id)

      tasks.value = tasks.value.map(candidate => (candidate.id === task.id ? result.completed : candidate))

      // A repeating chore comes back with its next occurrence; showing it
      // straight away is what makes the repeat visible.
      if (result.next) tasks.value = [result.next, ...tasks.value]
      if (!showCompleted.value) {
        tasks.value = tasks.value.filter(candidate => candidate.id !== task.id)
      }
    } else {
      const reopened = await tasksApi.reopen(task.id)
      tasks.value = tasks.value.map(candidate => (candidate.id === task.id ? reopened : candidate))
    }
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not update the task'
  } finally {
    const next = new Set(pending.value)
    next.delete(task.id)
    pending.value = next
  }
}

function openEditor(task: TaskItem | null): void {
  editing.value = task
  editorError.value = null
  editorOpen.value = true
}

async function save(changes: NewTaskItem): Promise<void> {
  saving.value = true
  editorError.value = null

  try {
    if (editing.value) {
      const updated = await tasksApi.update(editing.value.id, changes)
      tasks.value = tasks.value.map(candidate => (candidate.id === updated.id ? updated : candidate))
    } else {
      tasks.value = [await tasksApi.add(changes), ...tasks.value]
    }

    editorOpen.value = false
    // Assignee and category suggestions may have gained a new value.
    void refreshSuggestions()
  } catch (caught) {
    editorError.value = caught instanceof ApiRequestError ? describeError(caught) : 'Could not save the task'
  } finally {
    saving.value = false
  }
}

async function remove(task: TaskItem): Promise<void> {
  saving.value = true
  try {
    await tasksApi.remove(task.id)
    tasks.value = tasks.value.filter(candidate => candidate.id !== task.id)
    editorOpen.value = false
  } catch (caught) {
    editorError.value = caught instanceof ApiRequestError ? caught.message : 'Could not delete the task'
  } finally {
    saving.value = false
  }
}

async function refreshSuggestions(): Promise<void> {
  try {
    const suggestions = await tasksApi.suggestions()
    assignees.value = suggestions.assignees
    categories.value = suggestions.categories
  } catch {
    // Suggestions are a convenience; failing to refresh them is not worth
    // interrupting anyone over.
  }
}

/**
 * Toggling "show completed" changes what the API is asked for, so it reloads
 * rather than filtering client-side.
 */
async function toggleShowCompleted(): Promise<void> {
  showCompleted.value = !showCompleted.value
  await load()
}

function describeError(caught: ApiRequestError): string {
  const details = caught.details
  if (Array.isArray(details)) {
    return details.map(issue => (issue as { message?: string }).message ?? String(issue)).join('; ')
  }
  return caught.message
}

const filterOptions = computed(() => [
  { value: '', label: 'Everyone' },
  ...assignees.value.map(name => ({ value: name, label: name }))
])
</script>

<template>
  <PageShell :padded="false">
    <template #toolbar>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <TextInput v-model="quickAdd" placeholder="Add a task and press enter" :disabled="adding" @enter="addQuick" />
        <ToolButton
          icon="plus"
          label="Add"
          variant="primary"
          :disabled="quickAdd.trim().length === 0 || adding"
          @click="addQuick"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControl
          v-if="filterOptions.length > 1"
          v-model="assigneeFilter"
          :options="filterOptions"
          @update:model-value="load"
        />
        <ToolButton
          :icon="showCompleted ? 'check' : 'clock'"
          :label="showCompleted ? 'Showing done' : 'Open only'"
          @click="toggleShowCompleted"
        />
      </div>
    </template>

    <ErrorState v-if="error && tasks.length === 0" :message="error" :retrying="loading" @retry="load" />

    <div v-else-if="loading && tasks.length === 0" class="flex flex-1 items-center justify-center py-16">
      <Spinner :size="28">Loading tasks…</Spinner>
    </div>

    <EmptyState
      v-else-if="tasks.length === 0"
      icon="tasks"
      title="Nothing on the list"
      description="Add a task above. Chores can repeat daily, weekly or monthly and will reappear once ticked off."
    />

    <div v-else class="flex flex-col gap-6 p-4">
      <p v-if="error" class="flex items-center gap-2 rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">
        <Icon name="warning" :size="16" />
        {{ error }}
      </p>

      <section v-for="group in groups" :key="group.key" class="flex flex-col gap-2">
        <h2 class="flex items-baseline gap-2 text-xs font-semibold tracking-wider uppercase" :class="group.tone">
          {{ group.label }}
          <span class="text-faint">{{ group.tasks.length }}</span>
        </h2>

        <ul class="flex flex-col gap-2">
          <TaskRow
            v-for="task in group.tasks"
            :key="task.id"
            :task="task"
            :hour24="settings.clock24Hour"
            :busy="pending.has(task.id)"
            @toggle="toggle"
            @edit="openEditor"
          />
        </ul>
      </section>

      <p class="pb-2 text-center text-xs text-faint">{{ openCount }} open {{ openCount === 1 ? 'task' : 'tasks' }}</p>
    </div>

    <TaskEditor
      :open="editorOpen"
      :task="editing"
      :assignees="assignees"
      :categories="categories"
      :saving="saving"
      :error="editorError"
      @close="editorOpen = false"
      @save="save"
      @remove="remove"
    />
  </PageShell>
</template>
