<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { notesApi } from '@/api/notes'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import NoteEditor from '@/components/notes/NoteEditor.vue'
import StickyNoteCard from '@/components/notes/StickyNote.vue'
import type { NewStickyNote, NoteKind, StickyNote } from '@/api/types'

/**
 * The corkboard.
 *
 * Notes are absolutely positioned by fractions of the board rather than
 * pixels, so the arrangement is preserved when the screen is rotated. New
 * notes are placed in the first free-ish slot rather than all landing on
 * top of each other in the corner.
 */
const notes = ref<StickyNote[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const pending = ref<Set<string>>(new Set())

const board = ref<HTMLElement | null>(null)
const boardSize = ref({ width: 1, height: 1 })

const editorOpen = ref(false)
const editing = ref<StickyNote | null>(null)
const defaultKind = ref<NoteKind>('text')
const saving = ref(false)
const editorError = ref<string | null>(null)

let observer: ResizeObserver | null = null

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    notes.value = await notesApi.list()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load notes'
  } finally {
    loading.value = false
  }
}

function measure(): void {
  const rect = board.value?.getBoundingClientRect()
  if (!rect) return

  boardSize.value = { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) }
}

onMounted(async () => {
  await load()
  measure()

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    if (board.value) observer.observe(board.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// --- placement --------------------------------------------------------------

/**
 * Somewhere sensible for a new note.
 *
 * Walks a coarse grid and picks the first cell that no existing note is
 * already sitting near, so adding several notes in a row does not build a
 * single unusable pile.
 */
function freeSlot(): { x: number; y: number } {
  const columns = 5
  const rows = 4

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = 0.03 + (column * 0.94) / columns
      const y = 0.04 + (row * 0.92) / rows

      const occupied = notes.value.some(note => Math.abs(note.x - x) < 0.08 && Math.abs(note.y - y) < 0.12)
      if (!occupied) return { x, y }
    }
  }

  // The board is full enough that overlapping is unavoidable; scatter instead.
  return { x: 0.05 + Math.random() * 0.7, y: 0.05 + Math.random() * 0.7 }
}

// --- actions ----------------------------------------------------------------

function openNew(kind: NoteKind): void {
  editing.value = null
  defaultKind.value = kind
  editorError.value = null
  editorOpen.value = true
}

function openNote(note: StickyNote): void {
  editing.value = note
  editorError.value = null
  editorOpen.value = true
}

async function save(changes: NewStickyNote): Promise<void> {
  saving.value = true
  editorError.value = null

  try {
    if (editing.value) {
      const updated = await notesApi.update(editing.value.id, changes)
      notes.value = notes.value.map(candidate => (candidate.id === updated.id ? updated : candidate))
    } else {
      const created = await notesApi.add({ ...changes, ...freeSlot() })
      notes.value = [...notes.value, created]
    }

    editorOpen.value = false
  } catch (caught) {
    editorError.value = caught instanceof ApiRequestError ? describeError(caught) : 'Could not save the note'
  } finally {
    saving.value = false
  }
}

async function remove(note: StickyNote): Promise<void> {
  saving.value = true
  try {
    await notesApi.remove(note.id)
    notes.value = notes.value.filter(candidate => candidate.id !== note.id)
    editorOpen.value = false
  } catch (caught) {
    editorError.value = caught instanceof ApiRequestError ? caught.message : 'Could not delete the note'
  } finally {
    saving.value = false
  }
}

async function move(payload: { note: StickyNote; x: number; y: number }): Promise<void> {
  const { note, x, y } = payload

  // Optimistic: the note is already under the finger, so snapping it back
  // while the request is in flight would look broken.
  notes.value = notes.value.map(candidate => (candidate.id === note.id ? { ...candidate, x, y } : candidate))

  try {
    await notesApi.update(note.id, { x, y })
    // Dragging a note also raises it, which is what anyone expects after
    // pulling one out of an overlapping pile.
    const raised = await notesApi.bringToFront(note.id)
    notes.value = notes.value.map(candidate => (candidate.id === raised.id ? raised : candidate))
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not move the note'
    await load()
  }
}

async function togglePin(note: StickyNote): Promise<void> {
  pending.value = new Set(pending.value).add(note.id)

  try {
    const updated = await notesApi.update(note.id, { pinned: !note.pinned })
    notes.value = notes.value.map(candidate => (candidate.id === updated.id ? updated : candidate))
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not update the note'
  } finally {
    const next = new Set(pending.value)
    next.delete(note.id)
    pending.value = next
  }
}

function describeError(caught: ApiRequestError): string {
  const details = caught.details
  if (Array.isArray(details)) {
    return details.map(issue => (issue as { message?: string }).message ?? String(issue)).join('; ')
  }
  if (details && typeof details === 'object' && 'field' in details) return caught.message
  return caught.message
}

const pinnedCount = computed(() => notes.value.filter(note => note.pinned).length)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-4 py-3">
      <ToolButton icon="plus" label="Type a note" variant="primary" @click="openNew('text')" />
      <ToolButton icon="draw" label="Handwrite" @click="openNew('ink')" />

      <span class="ml-auto text-sm text-faint">
        {{ notes.length }} {{ notes.length === 1 ? 'note' : 'notes' }}
        <template v-if="pinnedCount > 0"> · {{ pinnedCount }} pinned</template>
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

    <ErrorState v-if="error && notes.length === 0 && !loading" :message="error" :retrying="loading" @retry="load" />

    <div v-else-if="loading && notes.length === 0" class="flex flex-1 items-center justify-center">
      <Spinner :size="28">Loading notes…</Spinner>
    </div>

    <!--
      The board. A subtle woven texture reads as cork without an image asset,
      and gives the notes something to sit on so they do not look like they
      are floating in the page background.
    -->
    <div
      ref="board"
      class="relative min-h-0 flex-1 overflow-hidden"
      :style="{
        backgroundColor: 'var(--fd-surface)',
        backgroundImage: 'radial-gradient(color-mix(in srgb, var(--fd-border) 55%, transparent) 1px, transparent 1px)',
        backgroundSize: '14px 14px'
      }"
    >
      <EmptyState
        v-if="!loading && notes.length === 0"
        icon="notes"
        title="The board is empty"
        description="Type a note, or handwrite one with a finger or stylus. Pin a note to show it on the dashboard."
      />

      <StickyNoteCard
        v-for="note in notes"
        :key="note.id"
        :note="note"
        :board-width="boardSize.width"
        :board-height="boardSize.height"
        :busy="pending.has(note.id)"
        @open="openNote"
        @move="move"
        @toggle-pin="togglePin"
      />
    </div>

    <NoteEditor
      :open="editorOpen"
      :note="editing"
      :default-kind="defaultKind"
      :saving="saving"
      :error="editorError"
      @close="editorOpen = false"
      @save="save"
      @remove="remove"
    />
  </div>
</template>
