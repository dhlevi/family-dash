<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Field from '@/components/ui/Field.vue'
import Modal from '@/components/ui/Modal.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { fromDateInput, toDateTimeLocal } from '@/utils/datetime'
import { RECURRENCES, RECURRENCE_LABELS, type NewTaskItem, type RecurrenceKind, type TaskItem } from '@/api/types'

/**
 * Create or edit a task.
 *
 * A repeating task needs a due date to repeat from. The API rejects the
 * combination, so the form disables the repeat options until a date is set
 * rather than letting somebody hit a validation error.
 */
const props = defineProps<{
  open: boolean
  /** Null when creating. */
  task: TaskItem | null
  assignees: string[]
  categories: string[]
  saving?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [changes: NewTaskItem]
  remove: [task: TaskItem]
}>()

const title = ref('')
const notes = ref('')
const assignee = ref('')
const category = ref('')
const priority = ref<0 | 1 | 2 | 3>(0)
const dueAt = ref('')
const recurrence = ref<RecurrenceKind | ''>('')

const isEdit = computed(() => props.task !== null)
const hasDueDate = computed(() => dueAt.value.trim().length > 0)

watch(
  () => [props.open, props.task] as const,
  ([open, task]) => {
    if (!open) return

    title.value = task?.title ?? ''
    notes.value = task?.notes ?? ''
    assignee.value = task?.assignee ?? ''
    category.value = task?.category ?? ''
    priority.value = task?.priority ?? 0
    dueAt.value = task?.dueAt ? toDateTimeLocal(new Date(task.dueAt)) : ''
    recurrence.value = (task?.recurrence as RecurrenceKind | null) ?? ''
  },
  { immediate: true }
)

// Clearing the date has to clear the repeat, or the form would submit a
// combination the API refuses.
watch(hasDueDate, has => {
  if (!has) recurrence.value = ''
})

const canSave = computed(() => title.value.trim().length > 0 && !props.saving)

function submit(): void {
  if (!canSave.value) return

  const due = fromDateInput(dueAt.value)

  emit('save', {
    title: title.value.trim(),
    notes: notes.value.trim() || null,
    assignee: assignee.value.trim() || null,
    category: category.value.trim() || null,
    priority: priority.value,
    dueAt: due ? due.toISOString() : null,
    recurrence: recurrence.value === '' ? null : recurrence.value
  })
}

const priorityOptions = [
  { value: 0 as const, label: 'None' },
  { value: 1 as const, label: 'Low' },
  { value: 2 as const, label: 'High' },
  { value: 3 as const, label: 'Urgent' }
]

const recurrenceOptions = [
  { value: '' as const, label: 'Once' },
  ...RECURRENCES.map(kind => ({ value: kind, label: RECURRENCE_LABELS[kind].replace(/^Every /, '') }))
]
</script>

<template>
  <Modal :open="open" :title="isEdit ? 'Edit task' : 'New task'" :busy="saving" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

      <Field label="Task" for="task-title">
        <TextInput id="task-title" v-model="title" placeholder="What needs doing?" :disabled="saving" @enter="submit" />
      </Field>

      <Field label="Notes" for="task-notes">
        <TextInput id="task-notes" v-model="notes" multiline :rows="2" :disabled="saving" />
      </Field>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Who" for="task-assignee" hint="Anyone - this is just a label">
          <TextInput id="task-assignee" v-model="assignee" placeholder="Nobody in particular" :disabled="saving" />
          <div v-if="assignees.length > 0" class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="name in assignees"
              :key="name"
              type="button"
              class="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
              @click="assignee = name"
            >
              {{ name }}
            </button>
          </div>
        </Field>

        <Field label="Category" for="task-category">
          <TextInput id="task-category" v-model="category" placeholder="Optional" :disabled="saving" />
          <div v-if="categories.length > 0" class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="name in categories"
              :key="name"
              type="button"
              class="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
              @click="category = name"
            >
              {{ name }}
            </button>
          </div>
        </Field>
      </div>

      <Field label="Due" for="task-due">
        <TextInput id="task-due" v-model="dueAt" type="datetime-local" :disabled="saving" />
      </Field>

      <Field label="Repeat" :hint="hasDueDate ? undefined : 'Set a due date to make this repeat'">
        <SegmentedControl v-model="recurrence" :options="recurrenceOptions" :disabled="saving || !hasDueDate" />
      </Field>

      <Field label="Priority">
        <SegmentedControl v-model="priority" :options="priorityOptions" :disabled="saving" />
      </Field>
    </div>

    <template #actions>
      <ToolButton
        v-if="task"
        icon="trash"
        label="Delete"
        variant="danger"
        :disabled="saving"
        @click="emit('remove', task)"
      />
      <span class="flex-1" />
      <ToolButton label="Cancel" :disabled="saving" @click="emit('close')" />
      <ToolButton
        icon="check"
        :label="saving ? 'Saving…' : isEdit ? 'Save' : 'Add task'"
        variant="primary"
        :disabled="!canSave"
        @click="submit"
      />
    </template>
  </Modal>
</template>
