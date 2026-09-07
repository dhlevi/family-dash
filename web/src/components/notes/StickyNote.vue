<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import InkRender from './InkRender.vue'
import type { StickyNote } from '@/api/types'

/**
 * One note on the corkboard.
 *
 * Dragged with pointer events so a finger, a stylus and a mouse all behave
 * identically. A press that barely moves is a tap and opens the note; past a
 * few pixels it becomes a drag and never opens it — otherwise every attempt
 * to move a note would also open the editor.
 *
 * Positions are fractions of the board, not pixels, so the arrangement
 * survives the screen being rotated between portrait and landscape.
 */
const props = defineProps<{
  note: StickyNote
  boardWidth: number
  boardHeight: number
  busy?: boolean
}>()

const emit = defineEmits<{
  open: [note: StickyNote]
  move: [payload: { note: StickyNote; x: number; y: number }]
  togglePin: [note: StickyNote]
}>()

/** Past this many pixels a press is a drag, not a tap. */
const DRAG_THRESHOLD = 6

const element = ref<HTMLElement | null>(null)
const dragging = ref(false)

/** Position while dragging; null when it should come from the note itself. */
const localPosition = ref<{ x: number; y: number } | null>(null)

let pointerId: number | null = null
let startClient = { x: 0, y: 0 }
let startFraction = { x: 0, y: 0 }
let moved = false

const position = computed(() => localPosition.value ?? { x: props.note.x, y: props.note.y })

/**
 * A small, stable tilt per note, derived from its id so it never changes
 * between renders. Makes a board of notes look pinned up rather than laid
 * out on a grid.
 */
const tilt = computed(() => {
  // FNV-1a. A weaker hash gives ids that differ by one character almost the
  // same angle, which would leave a run of notes looking suspiciously
  // parallel.
  let hash = 2166136261
  for (const character of props.note.id) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  const normalised = (hash >>> 0) / 4294967296
  return (normalised * 5 - 2.5).toFixed(2)
})

const style = computed(() => ({
  left: `${position.value.x * 100}%`,
  top: `${position.value.y * 100}%`,
  backgroundColor: props.note.colour,
  zIndex: dragging.value ? 9999 : props.note.zIndex + 1,
  transform: `rotate(${dragging.value ? 0 : tilt.value}deg) scale(${dragging.value ? 1.04 : 1})`
}))

function onPointerDown(event: PointerEvent): void {
  if (props.busy) return
  if (pointerId !== null) return
  if (event.button !== 0 && event.button !== -1) return

  pointerId = event.pointerId
  startClient = { x: event.clientX, y: event.clientY }
  startFraction = { x: props.note.x, y: props.note.y }
  moved = false

  try {
    element.value?.setPointerCapture(event.pointerId)
  } catch {
    // Capture is a convenience; the drag still works without it.
  }
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return

  const deltaX = event.clientX - startClient.x
  const deltaY = event.clientY - startClient.y

  if (!moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return

  moved = true
  dragging.value = true

  const noteRect = element.value?.getBoundingClientRect()

  // Clamp so a note can always be grabbed again: its top-left stays on the
  // board and its body cannot be pushed entirely past the right or bottom.
  const maxX = noteRect && props.boardWidth > 0 ? Math.max(0, 1 - noteRect.width / props.boardWidth) : 1
  const maxY = noteRect && props.boardHeight > 0 ? Math.max(0, 1 - noteRect.height / props.boardHeight) : 1

  localPosition.value = {
    x: clamp(startFraction.x + deltaX / props.boardWidth, 0, maxX),
    y: clamp(startFraction.y + deltaY / props.boardHeight, 0, maxY)
  }
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return

  try {
    element.value?.releasePointerCapture(event.pointerId)
  } catch {
    // Already released.
  }

  pointerId = null

  if (moved && localPosition.value) {
    emit('move', { note: props.note, x: localPosition.value.x, y: localPosition.value.y })
    // Keep the dragged position on screen until the parent's update lands,
    // so the note does not visibly snap back and forward.
    dragging.value = false
  } else {
    localPosition.value = null
    dragging.value = false
    emit('open', props.note)
  }

  moved = false
}

function onPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return

  pointerId = null
  moved = false
  dragging.value = false
  localPosition.value = null
}

/** Once the note prop catches up with the drag, stop overriding it. */
function syncFromProps(): void {
  if (localPosition.value && props.note.x === localPosition.value.x && props.note.y === localPosition.value.y) {
    localPosition.value = null
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

defineExpose({ syncFromProps })
</script>

<template>
  <div
    ref="element"
    class="absolute flex w-[13.5rem] cursor-grab touch-none flex-col overflow-hidden rounded-sm shadow-lg transition-[transform,box-shadow] duration-150 select-none active:cursor-grabbing portrait:w-[11rem]"
    :class="[dragging ? 'shadow-2xl duration-0' : '', busy ? 'opacity-60' : '']"
    :style="style"
    role="button"
    :aria-label="note.kind === 'ink' ? 'Handwritten note' : note.body"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @transitionend="syncFromProps"
  >
    <!-- Pin: on top of the note, and its own target so pinning does not drag. -->
    <button
      type="button"
      class="absolute top-1 right-1 z-10 grid size-8 place-items-center rounded-full transition-colors"
      :class="note.pinned ? 'text-black/70 hover:bg-black/10' : 'text-black/25 hover:bg-black/10 hover:text-black/50'"
      :aria-label="note.pinned ? 'Unpin from dashboard' : 'Pin to dashboard'"
      :aria-pressed="note.pinned"
      @pointerdown.stop
      @click.stop="emit('togglePin', note)"
    >
      <Icon name="notes" :size="16" :stroke-width="note.pinned ? 2.5 : 1.75" />
    </button>

    <!--
      Note text is always dark: the note itself is a light pastel in both
      themes, so it must not follow the theme's foreground colour.
    -->
    <div v-if="note.kind === 'text'" class="min-h-[6.5rem] px-3 py-3 pr-9">
      <p class="text-[0.9375rem] leading-snug break-words whitespace-pre-wrap text-[#1a1f2b]">
        {{ note.body }}
      </p>
    </div>

    <div v-else class="flex flex-col">
      <div class="aspect-[4/3] w-full">
        <InkRender
          :strokes="note.strokes"
          :surface-width="note.inkWidth ?? 640"
          :surface-height="note.inkHeight ?? 480"
          fit="surface"
        />
      </div>
      <p
        v-if="note.body"
        class="border-t border-black/10 px-3 py-1.5 text-xs font-medium break-words text-[#1a1f2b]/80"
      >
        {{ note.body }}
      </p>
    </div>
  </div>
</template>
