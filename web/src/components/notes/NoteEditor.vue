<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ColourPicker from '@/components/ui/ColourPicker.vue'
import Field from '@/components/ui/Field.vue'
import Modal from '@/components/ui/Modal.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import TextInput from '@/components/ui/TextInput.vue'
import Toggle from '@/components/ui/Toggle.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import InkCanvas from './InkCanvas.vue'
import { NOTE_COLOURS, type InkStroke, type NewStickyNote, type NoteKind, type StickyNote } from '@/api/types'

/**
 * Create or edit a sticky note, typed or handwritten.
 *
 * The medium is chosen once, when the note is created, and cannot be
 * switched afterwards — the API refuses it, because discarding somebody's
 * handwriting to accept typed text (or the reverse) silently destroys work.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    /** Null when creating. */
    note: StickyNote | null
    /** Which medium a new note starts on, so the board can offer both directly. */
    defaultKind?: NoteKind
    saving?: boolean
    error?: string | null
  }>(),
  { defaultKind: 'text', saving: false, error: null }
)

const emit = defineEmits<{
  close: []
  save: [changes: NewStickyNote]
  remove: [note: StickyNote]
}>()

const kind = ref<NoteKind>('text')
const body = ref('')
const colour = ref<string>(NOTE_COLOURS[0])
const pinned = ref(false)
const strokes = ref<InkStroke[]>([])
const surface = ref<{ width: number; height: number }>({ width: 640, height: 480 })

const isEdit = computed(() => props.note !== null)

watch(
  () => [props.open, props.note, props.defaultKind] as const,
  ([open, note]) => {
    if (!open) return

    kind.value = note?.kind ?? props.defaultKind
    body.value = note?.body ?? ''
    colour.value = note?.colour ?? NOTE_COLOURS[0]
    pinned.value = note?.pinned ?? false
    strokes.value = note ? [...note.strokes] : []

    if (note?.inkWidth && note?.inkHeight) {
      surface.value = { width: note.inkWidth, height: note.inkHeight }
    }
  },
  { immediate: true }
)

const canSave = computed(() => {
  if (props.saving) return false

  return kind.value === 'text' ? body.value.trim().length > 0 : strokes.value.length > 0
})

const hint = computed(() => {
  if (canSave.value) return null

  return kind.value === 'text' ? 'Type something to save this note' : 'Write something to save this note'
})

function submit(): void {
  if (!canSave.value) return

  const changes: NewStickyNote = {
    kind: kind.value,
    body: body.value.trim(),
    colour: colour.value,
    pinned: pinned.value
  }

  if (kind.value === 'ink') {
    changes.strokes = strokes.value
    changes.inkWidth = surface.value.width
    changes.inkHeight = surface.value.height
  }

  emit('save', changes)
}

const kindOptions = [
  { value: 'text' as const, label: 'Type' },
  { value: 'ink' as const, label: 'Handwrite' }
]
</script>

<template>
  <Modal :open="open" :title="isEdit ? 'Edit note' : 'New note'" :busy="saving" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

      <!-- Only offered when creating: the medium is fixed thereafter. -->
      <Field v-if="!isEdit" label="How do you want to write it?">
        <SegmentedControl v-model="kind" :options="kindOptions" block :disabled="saving" />
      </Field>

      <Field v-if="kind === 'text'" label="Note" for="note-body">
        <TextInput
          id="note-body"
          v-model="body"
          multiline
          :rows="4"
          placeholder="Swimming kit in the blue bag…"
          :disabled="saving"
        />
      </Field>

      <template v-else>
        <InkCanvas
          v-model="strokes"
          :background="colour"
          :surface-width="note?.inkWidth ?? null"
          :surface-height="note?.inkHeight ?? null"
          :disabled="saving"
          @update:surface="surface = $event"
        />

        <Field label="Label" for="note-caption" hint="Optional — helps find the note later">
          <TextInput id="note-caption" v-model="body" placeholder="Optional" :disabled="saving" />
        </Field>
      </template>

      <Field label="Paper">
        <ColourPicker v-model="colour" :palette="NOTE_COLOURS" :disabled="saving" />
      </Field>

      <Toggle
        v-model="pinned"
        label="Pin to the dashboard"
        hint="Pinned notes appear in the Notes widget"
        :disabled="saving"
      />
    </div>

    <template #actions>
      <ToolButton
        v-if="note"
        icon="trash"
        label="Delete"
        variant="danger"
        :disabled="saving"
        @click="emit('remove', note)"
      />
      <span class="flex-1" />
      <span v-if="hint" class="self-center text-xs text-faint">{{ hint }}</span>
      <ToolButton label="Cancel" :disabled="saving" @click="emit('close')" />
      <ToolButton
        icon="check"
        :label="saving ? 'Saving…' : isEdit ? 'Save' : 'Add note'"
        variant="primary"
        :disabled="!canSave"
        @click="submit"
      />
    </template>
  </Modal>
</template>
