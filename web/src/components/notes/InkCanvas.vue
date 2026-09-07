<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { shouldKeep, simplify, toSmoothPath, totalPoints } from '@/utils/ink'
import { INK_COLOURS, type InkPoint, type InkStroke } from '@/api/types'

/**
 * A surface for writing on with a finger or a stylus.
 *
 * Pointer events rather than touch or mouse events, because they are the
 * only ones that report a stylus properly — `pressure`, and a `pointerType`
 * that distinguishes a pen from the palm resting beside it.
 *
 * Rendered as SVG rather than a canvas: strokes stay vectors, so a note
 * re-renders crisply at any size and there is no device-pixel-ratio
 * bookkeeping. Completed strokes are static elements and only the stroke in
 * progress re-renders, which keeps the cost of a long line flat.
 */
const props = withDefaults(
  defineProps<{
    /** Existing strokes, when editing a note that has already been drawn. */
    modelValue: InkStroke[]
    surfaceWidth?: number | null
    surfaceHeight?: number | null
    background?: string
    disabled?: boolean
  }>(),
  { surfaceWidth: null, surfaceHeight: null, background: '#ffe066', disabled: false }
)

const emit = defineEmits<{
  'update:modelValue': [strokes: InkStroke[]]
  /** The coordinate space the strokes are in; saved alongside them. */
  'update:surface': [size: { width: number; height: number }]
}>()

const PEN_WIDTHS = [2, 4, 7, 12] as const

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
const undone = shallowRef<InkStroke[]>([])

/** The stroke being drawn. Kept separate so committed strokes never re-render. */
const active = ref<InkPoint[]>([])
const activePointerId = ref<number | null>(null)

const colour = ref<string>(INK_COLOURS[0])
const width = ref<number>(PEN_WIDTHS[1])

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
  const nextWidth = Math.max(Math.round(rect.width), 1)
  const nextHeight = Math.max(Math.round(rect.height), 1)

  if (nextWidth === surface.value.width && nextHeight === surface.value.height) return

  // Rescale anything already drawn into the new space. Without this, a
  // rotation mid-note would leave old strokes in the old coordinate system
  // and new ones would land somewhere else entirely.
  const scaleX = nextWidth / surface.value.width
  const scaleY = nextHeight / surface.value.height

  if (strokes.value.length > 0 && (scaleX !== 1 || scaleY !== 1)) {
    strokes.value = strokes.value.map(stroke => ({
      ...stroke,
      points: stroke.points.map(point => ({ x: point.x * scaleX, y: point.y * scaleY, p: point.p }))
    }))
    emit('update:modelValue', strokes.value)
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

function toSurfacePoint(event: PointerEvent): InkPoint {
  const element = surfaceEl.value
  if (!element) return { x: 0, y: 0, p: 0.5 }

  const rect = element.getBoundingClientRect()

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

  event.preventDefault()
  activePointerId.value = event.pointerId

  // Capture so the stroke keeps following the pointer past the edge of the
  // surface instead of stopping dead when it leaves.
  try {
    surfaceEl.value?.setPointerCapture(event.pointerId)
  } catch {
    // Capture is a convenience; drawing still works without it.
  }

  active.value = [toSurfacePoint(event)]
}

function onPointerMove(event: PointerEvent): void {
  if (props.disabled || event.pointerId !== activePointerId.value) return
  if (event.pointerType === 'pen') lastPenAt = Date.now()

  event.preventDefault()

  // A stylus reports faster than the browser fires events; the coalesced
  // list holds the samples that were merged into this one, and using them
  // is the difference between smooth handwriting and visible corners.
  const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  const events = samples.length > 0 ? samples : [event]

  const next = [...active.value]
  for (const sample of events) {
    const point = toSurfacePoint(sample)
    if (shouldKeep(next.at(-1), point)) next.push(point)
  }

  active.value = next
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
  // partial stroke rather than leaving half a letter behind.
  activePointerId.value = null
  active.value = []
}

function commit(): void {
  if (active.value.length === 0) return

  // Simplify on commit rather than during: the live line stays faithful to
  // the pointer, and what gets stored is a fraction of the samples.
  strokes.value = [...strokes.value, { colour: colour.value, width: width.value, points: simplify(active.value) }]
  active.value = []
  undone.value = []

  emit('update:modelValue', strokes.value)
}

// --- history ----------------------------------------------------------------

function undo(): void {
  const last = strokes.value.at(-1)
  if (!last) return

  strokes.value = strokes.value.slice(0, -1)
  undone.value = [...undone.value, last]
  emit('update:modelValue', strokes.value)
}

function redo(): void {
  const last = undone.value.at(-1)
  if (!last) return

  undone.value = undone.value.slice(0, -1)
  strokes.value = [...strokes.value, last]
  emit('update:modelValue', strokes.value)
}

function clear(): void {
  if (strokes.value.length === 0) return

  // Kept in the redo stack, so a mis-tap on Clear is recoverable.
  undone.value = [...strokes.value].reverse()
  strokes.value = []
  active.value = []
  emit('update:modelValue', strokes.value)
}

defineExpose({ clear, undo, isEmpty })
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Pens -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1.5" role="radiogroup" aria-label="Ink colour">
        <button
          v-for="option in INK_COLOURS"
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
          v-for="option in PEN_WIDTHS"
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
          :disabled="disabled || strokes.length === 0"
          @click="undo"
        >
          <Icon name="refresh" :size="20" class="-scale-x-100" />
        </button>
        <button
          type="button"
          class="grid size-11 place-items-center rounded-card text-muted transition-colors hover:bg-surface-2 disabled:opacity-35"
          aria-label="Redo"
          :disabled="disabled || undone.length === 0"
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
    <div class="relative overflow-hidden rounded-card border-2 border-line" :style="{ backgroundColor: background }">
      <svg
        ref="surfaceEl"
        :viewBox="viewBox"
        preserveAspectRatio="none"
        class="block aspect-[4/3] w-full touch-none select-none"
        :class="disabled ? 'cursor-not-allowed' : 'cursor-crosshair'"
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
          v-if="activePath"
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
        Write here with a finger or stylus
      </p>
    </div>

    <p class="text-xs text-faint">
      {{ strokes.length }} {{ strokes.length === 1 ? 'stroke' : 'strokes' }}, {{ pointCount }} points
    </p>
  </div>
</template>
