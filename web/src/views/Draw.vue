<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { drawingsApi } from '@/api/drawings'
import InkCanvas from '@/components/ink/InkCanvas.vue'
import InkRender from '@/components/ink/InkRender.vue'
import ColourPicker from '@/components/ui/ColourPicker.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { inkSignature } from '@/utils/ink'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import { useSettingsStore } from '@/stores/settings'
import { DRAW_COLOURS, DRAW_WIDTHS, PAPER_COLOURS, type Drawing, type InkStroke } from '@/api/types'

/**
 * The drawing page.
 *
 * Reuses the ink control built for handwritten sticky notes — same pointer
 * handling, same stylus pressure and palm rejection, same vector storage —
 * with an eraser, a wider palette and the whole panel instead of a card.
 * Sharing it means a fix to stylus handling improves both places at once.
 */
type Mode = 'draw' | 'saved'

const settings = useSettingsStore()

const mode = ref<Mode>('draw')

// --- the drawing in progress ------------------------------------------------

/** Null while the canvas holds something that has never been saved. */
const currentId = ref<string | null>(null)

/**
 * Identifies the sheet being drawn on, and keys the canvas.
 *
 * The canvas owns its strokes and its undo history once mounted, so handing
 * it a new `modelValue` is not enough — starting a new drawing has to give
 * it a new identity, which remounts it empty with nothing to undo. Counting
 * rather than using the drawing id, because "new" happens repeatedly and
 * each one is a different sheet of paper.
 */
const sheet = ref(0)
const title = ref('')
const strokes = ref<InkStroke[]>([])
const background = ref<string>(PAPER_COLOURS[0])
const surface = ref({ width: 1200, height: 800 })

/** The strokes as last saved, to tell a real change from a re-render. */
const savedSignature = ref(inkSignature([]))

const saving = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const signature = computed(() => inkSignature(strokes.value))
const dirty = computed(() => signature.value !== savedSignature.value)
const isEmpty = computed(() => strokes.value.length === 0)

function announce(message: string): void {
  notice.value = message
  setTimeout(() => (notice.value = null), 3000)
}

// --- the gallery ------------------------------------------------------------

const drawings = ref<Drawing[]>([])
const loadingGallery = ref(false)

async function loadGallery(): Promise<void> {
  loadingGallery.value = true
  try {
    drawings.value = await drawingsApi.list()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load saved drawings'
  } finally {
    loadingGallery.value = false
  }
}

onMounted(async () => {
  if (!settings.loaded) void settings.load()
  await loadGallery()
})

// --- saving -----------------------------------------------------------------

async function save(): Promise<void> {
  if (isEmpty.value || saving.value) return

  saving.value = true
  error.value = null

  try {
    const payload = {
      title: title.value.trim() || 'Untitled',
      strokes: strokes.value,
      background: background.value,
      width: surface.value.width,
      height: surface.value.height
    }

    const saved = currentId.value ? await drawingsApi.update(currentId.value, payload) : await drawingsApi.add(payload)

    currentId.value = saved.id
    title.value = saved.title
    savedSignature.value = inkSignature(saved.strokes)

    announce('Saved')
    void loadGallery()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? describeError(caught) : 'Could not save the drawing'
  } finally {
    saving.value = false
  }
}

/** Save the current canvas as a new drawing, leaving the original alone. */
async function saveAsCopy(): Promise<void> {
  currentId.value = null
  title.value = title.value.trim().length > 0 ? `${title.value} (copy)` : ''
  await save()
}

// --- opening and starting over ----------------------------------------------

/** What the pending confirmation will do once the user accepts losing changes. */
const pendingAction = ref<{ kind: 'new' } | { kind: 'open'; drawing: Drawing } | null>(null)

function startNew(): void {
  if (dirty.value && !isEmpty.value) {
    pendingAction.value = { kind: 'new' }
    return
  }
  applyNew()
}

function applyNew(): void {
  currentId.value = null
  title.value = ''
  strokes.value = []
  background.value = PAPER_COLOURS[0]
  savedSignature.value = inkSignature([])
  sheet.value += 1
  pendingAction.value = null
  mode.value = 'draw'
}

function open(drawing: Drawing): void {
  if (dirty.value && !isEmpty.value) {
    pendingAction.value = { kind: 'open', drawing }
    return
  }
  applyOpen(drawing)
}

function applyOpen(drawing: Drawing): void {
  currentId.value = drawing.id
  title.value = drawing.title
  strokes.value = [...drawing.strokes]
  background.value = drawing.background
  surface.value = { width: drawing.width, height: drawing.height }
  savedSignature.value = inkSignature(drawing.strokes)
  sheet.value += 1
  pendingAction.value = null
  mode.value = 'draw'
}

function confirmPending(): void {
  const action = pendingAction.value
  if (!action) return

  if (action.kind === 'new') applyNew()
  else applyOpen(action.drawing)
}

// --- deleting ---------------------------------------------------------------

const confirmingRemoval = ref<Drawing | null>(null)

async function remove(drawing: Drawing): Promise<void> {
  try {
    await drawingsApi.remove(drawing.id)

    // If the open drawing was the one deleted, the canvas keeps the artwork
    // but forgets where it came from, so saving makes a new one rather than
    // failing against a missing id.
    if (currentId.value === drawing.id) {
      currentId.value = null
      savedSignature.value = 'deleted'
    }

    confirmingRemoval.value = null
    await loadGallery()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not delete the drawing'
  }
}

function describeError(caught: ApiRequestError): string {
  const details = caught.details
  if (Array.isArray(details)) {
    return details.map(issue => (issue as { message?: string }).message ?? String(issue)).join('; ')
  }
  return caught.message
}

function savedLabel(drawing: Drawing): string {
  const at = new Date(drawing.updatedAt)
  return `${formatRelativeDay(at)} ${formatTime(at, settings.clock24Hour)}`
}

const modes = computed(() => [
  { value: 'draw' as const, label: 'Draw' },
  { value: 'saved' as const, label: `Saved${drawings.value.length > 0 ? ` (${drawings.value.length})` : ''}` }
])
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Toolbar -->
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-4 py-3">
      <SegmentedControl v-model="mode" :options="modes" />

      <template v-if="mode === 'draw'">
        <TextInput v-model="title" placeholder="Untitled" class="max-w-56" :disabled="saving" />

        <span v-if="dirty && !isEmpty" class="text-xs text-warn">unsaved</span>
        <span v-else-if="notice" class="flex items-center gap-1 text-xs text-success">
          <Icon name="check" :size="14" />
          {{ notice }}
        </span>

        <div class="ml-auto flex items-center gap-2">
          <ToolButton icon="plus" label="New" :disabled="saving" @click="startNew" />
          <ToolButton v-if="currentId" label="Save a copy" :disabled="saving || isEmpty" @click="saveAsCopy" />
          <ToolButton
            icon="check"
            :label="saving ? 'Saving…' : currentId ? 'Save' : 'Save drawing'"
            variant="primary"
            :disabled="saving || isEmpty"
            @click="save"
          />
        </div>
      </template>

      <span v-else class="ml-auto text-sm text-faint"> Tap a drawing to carry on with it </span>
    </div>

    <p
      v-if="error"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/10 px-4 py-2 text-sm text-danger"
    >
      <Icon name="warning" :size="16" />
      <span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="font-medium underline" @click="error = null">Dismiss</button>
    </p>

    <!-- Canvas -->
    <div v-if="mode === 'draw'" class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <InkCanvas
        :key="sheet"
        v-model="strokes"
        class="min-h-0 flex-1"
        :background="background"
        :surface-width="surface.width"
        :surface-height="surface.height"
        :palette="DRAW_COLOURS"
        :widths="DRAW_WIDTHS"
        :aspect-class="null"
        allow-erase
        :disabled="saving"
        @update:surface="surface = $event"
      />

      <div class="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2">
        <Field label="Paper">
          <ColourPicker v-model="background" :palette="PAPER_COLOURS" :disabled="saving" />
        </Field>
      </div>
    </div>

    <!-- Gallery -->
    <div v-else class="fd-scroll min-h-0 flex-1 p-4">
      <div v-if="loadingGallery && drawings.length === 0" class="flex justify-center py-16">
        <Spinner :size="28">Loading drawings…</Spinner>
      </div>

      <EmptyState
        v-else-if="drawings.length === 0"
        icon="draw"
        title="Nothing saved yet"
        description="Draw something on the Draw tab and save it. Drawings are kept as vectors, so they stay sharp at any size."
      />

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        <div
          v-for="drawing in drawings"
          :key="drawing.id"
          class="group flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-line-strong"
        >
          <button
            type="button"
            class="block aspect-[4/3] w-full"
            :style="{ backgroundColor: drawing.background }"
            :aria-label="`Open ${drawing.title}`"
            @click="open(drawing)"
          >
            <!-- Thumbnails render from the strokes themselves, so there is no
                 rasterised copy to keep in step with edits. -->
            <InkRender
              :strokes="drawing.strokes"
              :surface-width="drawing.width"
              :surface-height="drawing.height"
              fit="surface"
            />
          </button>

          <div class="flex items-center gap-2 border-t border-line px-3 py-2">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-ink">{{ drawing.title }}</span>
              <span class="block truncate text-xs text-faint">{{ savedLabel(drawing) }}</span>
            </span>
            <ToolButton
              icon="trash"
              :label="`Delete ${drawing.title}`"
              icon-only
              variant="danger"
              @click="confirmingRemoval = drawing"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Losing unsaved work is worth a tap on a screen anyone can touch. -->
    <Modal :open="pendingAction !== null" title="Discard unsaved changes?" @close="pendingAction = null">
      <p class="text-sm text-muted">
        The current drawing has changes that have not been saved.
        {{ pendingAction?.kind === 'open' ? 'Opening another drawing' : 'Starting a new one' }}
        will discard them.
      </p>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Keep drawing" @click="pendingAction = null" />
        <ToolButton label="Discard" variant="danger" @click="confirmPending" />
      </template>
    </Modal>

    <Modal :open="confirmingRemoval !== null" title="Delete this drawing?" @close="confirmingRemoval = null">
      <p class="text-sm text-muted">
        <strong class="font-medium text-ink">{{ confirmingRemoval?.title }}</strong> will be deleted. This cannot be
        undone.
      </p>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Cancel" @click="confirmingRemoval = null" />
        <ToolButton
          icon="trash"
          label="Delete"
          variant="danger"
          @click="confirmingRemoval && remove(confirmingRemoval)"
        />
      </template>
    </Modal>
  </div>
</template>
