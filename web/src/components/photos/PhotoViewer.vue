<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import type { Photo } from '@/api/types'

/**
 * Full-screen picture viewer, and the slideshow.
 *
 * Deliberately not a Modal: this covers the nav rail as well, because a
 * picture on a wall display should be the whole screen. Everything is driven
 * by large on-screen controls rather than gestures.
 */
const props = defineProps<{
  photos: Photo[]
  /** Index into `photos`. */
  index: number
  /** Seconds per picture when playing. */
  intervalSeconds: number
  /** Start advancing immediately, as the dashboard screensaver does. */
  autoPlay?: boolean
  /** Match the header clock rather than the browser locale. */
  hour24?: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:index': [index: number]
  favourite: [photo: Photo, favourite: boolean]
  remove: [photo: Photo]
}>()

const playing = ref(props.autoPlay ?? false)
const failed = ref(false)
const confirmingRemoval = ref(false)

/**
 * True while the full-size picture is on its way.
 *
 * Full-size images are not small, the Pi is not fast, and a HEIC is
 * converted the first time it is opened, so without this the screen goes
 * black for a moment and looks broken rather than busy.
 */
const loading = ref(true)

const photo = computed<Photo | undefined>(() => props.photos[props.index])

const position = computed(() => `${props.index + 1} of ${props.photos.length}`)

const taken = computed(() => {
  if (!photo.value?.takenAt) return null

  const at = new Date(photo.value.takenAt)
  return `${formatRelativeDay(at)} · ${formatTime(at, props.hour24 ?? true)}`
})

let timer: ReturnType<typeof setInterval> | null = null

function stopTimer(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

function startTimer(): void {
  stopTimer()
  if (!playing.value || props.photos.length < 2) return

  // Seconds, clamped: a zero would spin the CPU and the setting allows 3
  // upwards, but a stale value should not be able to break the page.
  timer = setInterval(() => step(1), Math.max(props.intervalSeconds, 3) * 1000)
}

watch(() => [playing.value, props.intervalSeconds, props.photos.length], startTimer)

/**
 * Moves by `delta`, wrapping at both ends.
 *
 * Wrapping rather than stopping because the slideshow is the point: a
 * kitchen display should keep cycling all evening without anyone touching
 * it.
 */
function step(delta: number): void {
  if (props.photos.length === 0) return

  const count = props.photos.length
  emit('update:index', (props.index + delta + count) % count)
}

/** A manual move restarts the clock, so the next picture gets a full turn. */
function nudge(delta: number): void {
  step(delta)
  startTimer()
}

function onKey(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      emit('close')
      break
    case 'ArrowRight':
      nudge(1)
      break
    case 'ArrowLeft':
      nudge(-1)
      break
    case ' ':
      event.preventDefault()
      playing.value = !playing.value
      break
  }
}

// A new picture gets a fresh chance to load, and closes any open confirmation.
watch(
  () => photo.value?.id,
  () => {
    failed.value = false
    loading.value = true
    confirmingRemoval.value = false
  }
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  startTimer()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  stopTimer()
})

/** A method rather than an inline pair of statements, which prettier splits
 *  across lines and the template compiler then rejects. */
function onLoadFailed(): void {
  loading.value = false
  failed.value = true
}

function confirmRemoval(): void {
  if (!photo.value) return

  emit('remove', photo.value)
  confirmingRemoval.value = false
}
</script>

<template>
  <div
    v-if="photo"
    class="fixed inset-0 z-50 flex flex-col bg-black"
    role="dialog"
    aria-modal="true"
    :aria-label="`Viewing ${photo.filename}`"
  >
    <!-- Controls sit over the picture rather than beside it, so the image
         gets the whole screen. -->
    <header
      class="absolute inset-x-0 top-0 z-10 flex items-start gap-3 bg-gradient-to-b from-black/70 to-transparent p-4"
    >
      <div class="min-w-0 flex-1">
        <p class="truncate text-base font-semibold text-white">{{ photo.filename }}</p>
        <p class="mt-0.5 text-xs text-white/70">
          {{ position }}
          <template v-if="photo.album"> · {{ photo.album }}</template>
          <template v-if="taken"> · {{ taken }}</template>
        </p>
      </div>

      <button
        type="button"
        class="grid size-12 shrink-0 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        aria-label="Close"
        @click="emit('close')"
      >
        <Icon name="close" :size="22" />
      </button>
    </header>

    <div class="flex min-h-0 flex-1 items-center justify-center">
      <img
        v-if="!failed"
        :key="photo.id"
        :src="photo.url"
        :alt="photo.filename"
        decoding="async"
        class="max-h-full max-w-full object-contain transition-opacity duration-200"
        :class="loading ? 'opacity-0' : 'opacity-100'"
        @load="loading = false"
        @error="onLoadFailed"
      />

      <div v-if="loading && !failed" class="absolute grid place-items-center">
        <Spinner :size="30" />
      </div>

      <div v-else class="flex flex-col items-center gap-3 p-8 text-center">
        <Icon name="warning" :size="34" class="text-white/60" />
        <p class="text-sm text-white/80">
          {{ photo.filename }} could not be shown.
          <template v-if="photo.mimeType === 'image/heic' || photo.mimeType === 'image/heif'">
            HEIC pictures need converting before a browser can display one, and that conversion failed for this file.
          </template>
          <template v-else> The file may have been removed from the media volume. </template>
        </p>
      </div>
    </div>

    <!-- Previous / next as full-height edge targets: the easiest thing to hit
         on a touchscreen without looking. -->
    <button
      v-if="photos.length > 1"
      type="button"
      class="absolute inset-y-0 left-0 z-10 grid w-20 place-items-center text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      aria-label="Previous photo"
      @click="nudge(-1)"
    >
      <Icon name="chevronLeft" :size="34" />
    </button>

    <button
      v-if="photos.length > 1"
      type="button"
      class="absolute inset-y-0 right-0 z-10 grid w-20 place-items-center text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      aria-label="Next photo"
      @click="nudge(1)"
    >
      <Icon name="chevronRight" :size="34" />
    </button>

    <footer
      class="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-4"
    >
      <button
        v-if="photos.length > 1"
        type="button"
        class="flex min-h-12 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-medium text-white transition-colors hover:bg-white/25"
        :aria-label="playing ? 'Pause the slideshow' : 'Play a slideshow'"
        @click="playing = !playing"
      >
        <Icon :name="playing ? 'pause' : 'play'" :size="18" :fill="playing ? 'none' : 'currentColor'" />
        {{ playing ? 'Pause' : 'Slideshow' }}
      </button>

      <button
        type="button"
        class="grid size-12 place-items-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
        :class="photo.favourite ? 'text-amber-300' : 'text-white'"
        :aria-label="photo.favourite ? 'Remove from favourites' : 'Make a favourite'"
        :aria-pressed="photo.favourite"
        @click="emit('favourite', photo, !photo.favourite)"
      >
        <Icon name="star" :size="20" :fill="photo.favourite ? 'currentColor' : 'none'" />
      </button>

      <button
        type="button"
        class="grid size-12 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-danger hover:text-white"
        aria-label="Delete this photo"
        @click="confirmingRemoval = true"
      >
        <Icon name="trash" :size="20" />
      </button>
    </footer>

    <!-- Deleting removes the file from the volume, so it asks first. -->
    <div
      v-if="confirmingRemoval"
      class="absolute inset-0 z-20 grid place-items-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Delete this photo?"
    >
      <div class="w-full max-w-sm rounded-card bg-surface p-5">
        <h2 class="text-base font-semibold text-ink">Delete this photo?</h2>
        <p class="mt-2 text-sm text-muted">
          {{ photo.filename }} will be removed from the media volume. This cannot be undone.
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="min-h-11 rounded-card px-4 text-sm font-medium text-muted hover:bg-surface-2"
            @click="confirmingRemoval = false"
          >
            Cancel
          </button>
          <button
            type="button"
            class="min-h-11 rounded-card bg-danger px-4 text-sm font-semibold text-white"
            @click="confirmRemoval"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
