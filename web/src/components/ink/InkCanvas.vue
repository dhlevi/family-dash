<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { ERASER_RADIUS, eraseStrokes, shouldKeep, simplify, toSmoothPath, totalPoints } from '@/utils/ink'
import { INK_COLOURS, type InkPoint, type InkStroke } from '@/api/types'

/**
 * A surface for writing or drawing on with a finger or a stylus.
 *
 * Shared by handwritten sticky notes and the drawing page, which is why it
 * lives here rather than under either of them. The differences between those
 * two uses are all props: palette, pen widths, whether an eraser is offered,
 * and whether the surface is a fixed-aspect card or fills its panel.
 *
 * Pointer events rather than touch or mouse events, because they are the
 * only ones that report a stylus properly: `pressure`, and a `pointerType`
 * that distinguishes a pen from the palm resting beside it.
 *
 * Rendered as SVG rather than a canvas: strokes stay vectors, so a note
 * re-renders crisply at any size and there is no device-pixel-ratio
 * bookkeeping. Completed strokes are static elements and only the stroke in
 * progress re-renders, which keeps the cost of a long line flat.
 */
const props = withDefaults(
  defineProps<{
    /** Existing strokes, when editing something already drawn. */
    modelValue: InkStroke[]
    surfaceWidth?: number | null
    surfaceHeight?: number | null
    background?: string
    disabled?: boolean
    /** Ink colours offered. Defaults to the note palette. */
    palette?: readonly string[]
    /** Pen widths offered. */
    widths?: readonly number[]
    /**
     * Tailwind aspect class for the surface, or null to fill the available
     * height. A sticky note wants a fixed 4:3 card; the drawing page wants
     * the whole panel.
     */
    aspectClass?: string | null
    /** Offer an eraser alongside the pen. */
    allowErase?: boolean
  }>(),
  {
    surfaceWidth: null,
    surfaceHeight: null,
    background: '#ffe066',
    disabled: false,
    palette: undefined,
    widths: undefined,
    aspectClass: 'aspect-[4/3]',
    allowErase: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [strokes: InkStroke[]]
  /** The coordinate space the strokes are in; saved alongside them. */
  'update:surface': [size: { width: number; height: number }]
}>()

const DEFAULT_WIDTHS = [2, 4, 7, 12] as const

/** Which of pen or eraser a stroke currently applies. */
type Tool = 'pen' | 'eraser'

/**
 * How long after a pen sample to keep ignoring touch input.
 *
 * Writing with a stylus means resting a hand on the screen, and those touch
 * points would otherwise draw. Anyone genuinely switching from stylus to
 * finger waits a moment first, so a short window costs nothing.
 */
const PALM_REJECTION_MS = 1500

const surfaceEl = ref<SVGSVGElement | null>(null)

/** The capture coordinate space. Matched to the element so ink lands under the pointer. */
const surface = ref({ width: props.surfaceWidth ?? 640, height: props.surfaceHeight ?? 480 })

const strokes = shallowRef<InkStroke[]>([...props.modelValue])

/** The stroke being drawn. Kept separate so committed strokes never re-render. */
const active = ref<InkPoint[]>([])
const activePointerId = ref<number | null>(null)

const inkColours = computed(() => props.palette ?? INK_COLOURS)
const penWidths = computed(() => props.widths ?? DEFAULT_WIDTHS)

const colour = ref<string>(props.palette?.[0] ?? INK_COLOURS[0])
const width = ref<number>(props.widths?.[1] ?? DEFAULT_WIDTHS[1])
const tool = ref<Tool>('pen')

/** Strokes removed by the eraser stroke in progress, for undo. */
let erasedThisStroke: InkStroke[] = []

let lastPenAt = 0
let observer: ResizeObserver | null = null

const viewBox = computed(() => `0 0 ${surface.value.width} ${surface.value.height}`)

const committedPaths = computed(() =>
  strokes.value
    .map(stroke => ({ d: toSmoothPath(stroke.points), colour: stroke.colour, width: stroke.width }))
    .filter(path => path.d.length > 0)
)

const activePath = computed(() => toSmoothPath(active.value))

const isEmpty = computed(() => strokes.value.length === 0 && active.value.length === 0)
const pointCount = computed(() => totalPoints(strokes.value))

// --- surface sizing ---------------------------------------------------------

function measure(): void {
  const element = surfaceEl.value
  if (!element) return

  const rect = element.getBoundingClientRect()

  // A surface with no area has not been laid out yet. The note editor opens
  // inside a transition, so the first measurement there happens before the
  // modal has a size. Recording that as a 1x1 coordinate space would squash
  // any existing strokes into a single point on the way in and scale them
  // back out again on the way, so wait for the resize observer instead.
  if (rect.width < 1 || rect.height < 1) return

  const nextWidth = Math.round(rect.width)
  const nextHeight = Math.round(rect.height)

  if (nextWidth === surface.value.width && nextHeight === surface.value.height) return

  // Rescale anything already drawn into the new space. Without this, a
  // rotation mid-note would leave old strokes in the old coordinate system
  // and new ones would land somewhere else entirely.
  const scaleX = nextWidth / surface.value.width
  const scaleY = nextHeight / surface.value.height

  if (scaleX !== 1 || scaleY !== 1) {
    const rescale = (stroke: InkStroke): InkStroke => ({
      ...stroke,
      points: stroke.points.map(point => ({ x: point.x * scaleX, y: point.y * scaleY, p: point.p }))
    })

    // Everything reachable from the canvas or its history, rescaled exactly
    // once each. History identifies strokes by reference, and a single
    // stroke can appear both on the canvas and in an operation, so they have
    // to come out of this as the same new object or undo would stop finding
    // them. The history needs it even when the canvas is empty: strokes an
    // eraser or Clear took out are still waiting there to be put back, and
    // rotating in between would otherwise return them in the old
    // coordinates.
    const strokesOf = (operation: Operation): InkStroke[] =>
      operation.kind === 'draw' ? [operation.stroke] : operation.strokes

    const reachable = [
      ...strokes.value,
      ...past.value.flatMap(strokesOf),
      ...future.value.flatMap(strokesOf),
      ...erasedThisStroke
    ]

    if (reachable.length > 0) {
      const replacements = new Map<InkStroke, InkStroke>(reachable.map(stroke => [stroke, rescale(stroke)]))
      const replace = (stroke: InkStroke): InkStroke => replacements.get(stroke) ?? rescale(stroke)

      past.value = past.value.map(remapOperation(replace))
      future.value = future.value.map(remapOperation(replace))
      erasedThisStroke = erasedThisStroke.map(replace)

      if (strokes.value.length > 0) {
        strokes.value = strokes.value.map(replace)
        emit('update:modelValue', strokes.value)
      }
    }
  }

  surface.value = { width: nextWidth, height: nextHeight }
  emit('update:surface', { ...surface.value })
}

onMounted(() => {
  measure()

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    if (surfaceEl.value) observer.observe(surfaceEl.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// --- drawing ----------------------------------------------------------------

/**
 * Where the surface currently is on screen, or null if it has no area.
 *
 * Mapping a pointer onto the surface divides by these, so a surface that has
 * not been laid out yet would turn every point into `Infinity` and put
 * `M Infinity Infinity` in the path. Returning null instead means the
 * pointer is simply ignored until there is something to draw on.
 */
function surfaceRect(): DOMRect | null {
  const rect = surfaceEl.value?.getBoundingClientRect()
  if (!rect || rect.width < 1 || rect.height < 1) return null
  return rect
}

function toSurfacePoint(event: PointerEvent, rect: DOMRect): InkPoint {
  return {
    x: ((event.clientX - rect.left) / rect.width) * surface.value.width,
    y: ((event.clientY - rect.top) / rect.height) * surface.value.height,
    // A mouse or finger reports 0 or 0.5 depending on the browser; normalise
    // the "no pressure information" case to the middle of the range.
    p: event.pressure > 0 && event.pressure !== 0.5 ? event.pressure : 0.5
  }
}

function isPalm(event: PointerEvent): boolean {
  return event.pointerType === 'touch' && Date.now() - lastPenAt < PALM_REJECTION_MS
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled) return
  // A second finger during a stroke would otherwise start a competing line.
  if (activePointerId.value !== null) return
  if (event.pointerType === 'pen') lastPenAt = Date.now()
  if (isPalm(event)) return
  // Right-click and stylus barrel buttons should not draw.
  if (event.button !== 0 && event.button !== -1) return

  const rect = surfaceRect()
  if (!rect) return

  event.preventDefault()
  activePointerId.value = event.pointerId

  // Capture so the stroke keeps following the pointer past the edge of the
  // surface instead of stopping dead when it leaves.
  try {
    surfaceEl.value?.setPointerCapture(event.pointerId)
  } catch {
    // Capture is a convenience; drawing still works without it.
  }

  active.value = [toSurfacePoint(event, rect)]

  // A tap with the eraser should remove what is under it, without needing
  // to be dragged first.
  if (tool.value === 'eraser') eraseUnderPointer()
}

function onPointerMove(event: PointerEvent): void {
  if (props.disabled || event.pointerId !== activePointerId.value) return
  if (event.pointerType === 'pen') lastPenAt = Date.now()

  const rect = surfaceRect()
  if (!rect) return

  event.preventDefault()

  // A stylus reports faster than the browser fires events; the coalesced
  // list holds the samples that were merged into this one, and using them
  // is the difference between smooth handwriting and visible corners.
  const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  const events = samples.length > 0 ? samples : [event]

  const next = [...active.value]
  for (const sample of events) {
    const point = toSurfacePoint(sample, rect)
    if (shouldKeep(next.at(-1), point)) next.push(point)
  }

  active.value = next

  if (tool.value === 'eraser') eraseUnderPointer()
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== activePointerId.value) return

  try {
    surfaceEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    // Already released.
  }

  activePointerId.value = null
  commit()
}

function onPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== activePointerId.value) return

  // A cancelled pointer (the browser took over for a gesture) discards the
  // partial stroke rather than leaving half a letter behind, and puts back
  // anything a cancelled eraser swipe had already removed.
  activePointerId.value = null
  active.value = []

  if (erasedThisStroke.length > 0) {
    strokes.value = [...strokes.value, ...erasedThisStroke]
    erasedThisStroke = []
    emit('update:modelValue', strokes.value)
  }
}

function commit(): void {
  if (active.value.length === 0) return

  if (tool.value === 'eraser') {
    // The erasing already happened as the pointer moved, so committing just
    // banks it as one operation.
    active.value = []

    if (erasedThisStroke.length > 0) {
      record({ kind: 'erase', strokes: erasedThisStroke })
      erasedThisStroke = []
      emit('update:modelValue', strokes.value)
    }
    return
  }

  // Simplify on commit rather than during: the live line stays faithful to
  // the pointer, and what gets stored is a fraction of the samples.
  const stroke: InkStroke = { colour: colour.value, width: width.value, points: simplify(active.value) }

  strokes.value = [...strokes.value, stroke]
  active.value = []
  record({ kind: 'draw', stroke })

  emit('update:modelValue', strokes.value)
}

/**
 * Remove whatever the eraser is currently over.
 *
 * Applied as the pointer moves rather than on release, so the canvas reacts
 * under the finger/stylus.
 */
function eraseUnderPointer(): void {
  const { kept, removed } = eraseStrokes(strokes.value, active.value, ERASER_RADIUS + width.value / 2)
  if (removed.length === 0) return

  strokes.value = kept
  erasedThisStroke = [...erasedThisStroke, ...removed]
}

// --- history ----------------------------------------------------------------

/**
 * History records *what happened*, not just which strokes existed.
 *
 * A stack of strokes is enough while drawing is the only operation, but the
 * eraser breaks it: undoing an erase has to put strokes back, which is the
 * opposite of undoing a draw. Keeping the operation means one undo reverses
 * one action whichever kind it was.
 */
type Operation =
  | { kind: 'draw'; stroke: InkStroke }
  | { kind: 'erase'; strokes: InkStroke[] }
  | { kind: 'clear'; strokes: InkStroke[] }

const past = shallowRef<Operation[]>([])
const future = shallowRef<Operation[]>([])

/** Rewrites an operation's stroke references through `replace`. */
function remapOperation(replace: (stroke: InkStroke) => InkStroke) {
  return (operation: Operation): Operation =>
    operation.kind === 'draw'
      ? { kind: 'draw', stroke: replace(operation.stroke) }
      : { ...operation, strokes: operation.strokes.map(replace) }
}

const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)

/** Records an operation, discarding any redo history beyond it. */
function record(operation: Operation): void {
  past.value = [...past.value, operation]
  future.value = []
}

function undo(): void {
  const operation = past.value.at(-1)
  if (!operation) return

  past.value = past.value.slice(0, -1)
  future.value = [...future.value, operation]

  if (operation.kind === 'draw') {
    strokes.value = strokes.value.filter(stroke => stroke !== operation.stroke)
  } else {
    // Restored at the end rather than at their original indexes: stacking
    // order only shows where strokes overlap, and the alternative is
    // tracking positions through every later edit.
    strokes.value = [...strokes.value, ...operation.strokes]
  }

  emit('update:modelValue', strokes.value)
}

function redo(): void {
  const operation = future.value.at(-1)
  if (!operation) return

  future.value = future.value.slice(0, -1)
  past.value = [...past.value, operation]

  if (operation.kind === 'draw') {
    strokes.value = [...strokes.value, operation.stroke]
  } else {
    strokes.value = strokes.value.filter(stroke => !operation.strokes.includes(stroke))
  }

  emit('update:modelValue', strokes.value)
}

function clear(): void {
  if (strokes.value.length === 0) return

  record({ kind: 'clear', strokes: strokes.value })
  strokes.value = []
  active.value = []
  emit('update:modelValue', strokes.value)
}

defineExpose({ clear, undo, redo, isEmpty })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <!-- Pens -->
    <div class="flex flex-wrap items-center gap-3">
      <div v-if="allowErase" class="flex items-center gap-1" role="radiogroup" aria-label="Tool">
        <button
          type="button"
          role="radio"
          :aria-checked="tool === 'pen'"
          aria-label="Pen"
          :disabled="disabled"
          class="grid size-11 place-items-center rounded-card transition-colors"
          :class="tool === 'pen' ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-2'"
          @click="tool = 'pen'"
        >
          <Icon name="draw" :size="20" />
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="tool === 'eraser'"
          aria-label="Eraser"
          :disabled="disabled"
          class="grid size-11 place-items-center rounded-card transition-colors"
          :class="tool === 'eraser' ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-2'"
          @click="tool = 'eraser'"
        >
          <Icon name="close" :size="20" />
        </button>
        <span class="mx-1 h-7 w-px bg-line" />
      </div>

      <div class="flex items-center gap-1.5" role="radiogroup" aria-label="Ink colour">
        <button
          v-for="option in inkColours"
          :key="option"
          type="button"
          role="radio"
          :aria-checked="option === colour"
          :aria-label="`Ink colour ${option}`"
          :disabled="disabled"
          class="grid size-10 place-items-center rounded-full transition-transform active:scale-95"
          :class="option === colour ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''"
          :style="{ backgroundColor: option }"
          @click="colour = option"
        >
          <Icon v-if="option === colour" name="check" :size="16" :stroke-width="3" class="text-white" />
        </button>
      </div>

      <div class="flex items-center gap-1.5" role="radiogroup" aria-label="Pen width">
        <button
          v-for="option in penWidths"
          :key="option"
          type="button"
          role="radio"
          :aria-checked="option === width"
          :aria-label="`Pen width ${option}`"
          :disabled="disabled"
          class="grid size-10 place-items-center rounded-card transition-colors"
          :class="option === width ? 'bg-accent-soft' : 'hover:bg-surface-2'"
          @click="width = option"
        >
          <span
            class="rounded-full"
            :style="{
              width: `${Math.min(option + 2, 16)}px`,
              height: `${Math.min(option + 2, 16)}px`,
              backgroundColor: colour
            }"
          />
        </button>
      </div>

      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="grid size-11 place-items-center rounded-card text-muted transition-colors hover:bg-surface-2 disabled:opacity-35"
          aria-label="Undo"
          :disabled="disabled || !canUndo"
          @click="undo"
        >
          <Icon name="refresh" :size="20" class="-scale-x-100" />
        </button>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-card text-muted transition-colors hover:bg-surface-2 disabled:opacity-35"
          aria-label="Redo"
          :disabled="disabled || !canRedo"
          @click="redo"
        >
          <Icon name="refresh" :size="20" />
        </button>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-card text-muted transition-colors hover:bg-danger/15 hover:text-danger disabled:opacity-35"
          aria-label="Clear"
          :disabled="disabled || strokes.length === 0"
          @click="clear"
        >
          <Icon name="trash" :size="20" />
        </button>
      </div>
    </div>

    <!-- The surface. touch-action:none stops the browser panning or zooming
         the page while a finger is drawing on it. -->
    <div
      class="relative min-h-0 overflow-hidden rounded-card border-2 border-line"
      :class="aspectClass ? '' : 'flex-1'"
      :style="{ backgroundColor: background }"
    >
      <svg
        ref="surfaceEl"
        role="img"
        :aria-label="allowErase ? 'Drawing surface' : 'Writing surface'"
        :viewBox="viewBox"
        preserveAspectRatio="none"
        class="block w-full touch-none select-none"
        :class="[
          aspectClass ?? 'h-full',
          disabled ? 'cursor-not-allowed' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'
        ]"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <path
          v-for="(path, index) in committedPaths"
          :key="index"
          :d="path.d"
          :stroke="path.colour"
          :stroke-width="path.width"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          v-if="activePath && tool === 'pen'"
          :d="activePath"
          :stroke="colour"
          :stroke-width="width"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <p
        v-if="isEmpty"
        class="pointer-events-none absolute inset-0 grid place-items-center text-sm font-medium text-black/35"
      >
        {{ allowErase ? 'Draw here with a finger or stylus' : 'Write here with a finger or stylus' }}
      </p>
    </div>

    <p class="text-xs text-faint">
      {{ strokes.length }} {{ strokes.length === 1 ? 'stroke' : 'strokes' }}, {{ pointCount }} points
    </p>
  </div>
</template>
