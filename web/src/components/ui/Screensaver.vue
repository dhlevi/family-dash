<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { photosApi } from '@/api/photos'
import { weatherApi } from '@/api/weather'
import WeatherIcon from '@/components/weather/WeatherIcon.vue'
import { useClock } from '@/composables/useClock'
import { formatDate, formatTime } from '@/utils/datetime'
import { useSettingsStore } from '@/stores/settings'
import type { Photo, WeatherReport } from '@/api/types'

/**
 * What the display shows when nobody is using it.
 *
 * A kitchen wall spends most of its day being walked past rather than read,
 * so the idle state is a clock and the weather over a slowly changing
 * photograph — more useful from across the room than the dashboard it
 * replaces, and it stops one layout being burnt into the panel for weeks.
 *
 * It works with no photos at all: a full-screen clock is still a better idle
 * state than a static dashboard.
 */
const emit = defineEmits<{ wake: [] }>()

/** How many pictures to cycle. Enough variety for an evening. */
const POOL_SIZE = 40

const settings = useSettingsStore()
const now = useClock()

const photos = ref<Photo[]>([])
const weather = ref<WeatherReport | null>(null)

/**
 * Two stacked layers, one of which is on show.
 *
 * The next picture is loaded into the hidden layer and only revealed once it
 * has decoded, which is what makes the change a crossfade rather than a
 * flash of nothing. Both layers keep their own `<img>`, so a slow load never
 * blanks what is currently up.
 *
 * The fade is a transition on a bound `opacity`, deliberately, rather than
 * Vue's `<Transition>`: that advances its classes on a requestAnimationFrame
 * which does not run while a page is hidden, and a screensaver caught
 * mid-fade would be stuck at opacity 0 — a black screen with a clock on it,
 * for as long as nobody touched the display. A bound style may or may not
 * animate, but it always ends up at the right value.
 */
const layers = ref<[Photo | null, Photo | null]>([null, null])
const active = ref(0)

/** Which layer is loading a picture that has not been shown yet. */
let pending: number | null = null

/** Position in `photos` of whatever is currently on show. */
let cursor = 0

const time = computed(() => formatTime(now.value, settings.clock24Hour))
const date = computed(() => formatDate(now.value))

let timer: ReturnType<typeof setInterval> | null = null

function advance(): void {
  if (photos.value.length < 2) return

  cursor = (cursor + 1) % photos.value.length
  const next = photos.value[cursor]
  if (!next) return

  const target = 1 - active.value
  layers.value = target === 0 ? [next, layers.value[1]] : [layers.value[0], next]
  pending = target
}

/** The hidden layer has its picture, so it can be brought forward. */
function onLoaded(layer: number): void {
  if (pending !== layer) return

  active.value = layer
  pending = null
}

/**
 * A picture that will not load leaves the pool and its turn passes to the
 * next one, rather than the slideshow stopping on it.
 */
function onFailed(layer: number): void {
  const failed = layers.value[layer]
  if (failed) photos.value = photos.value.filter(photo => photo.id !== failed.id)

  pending = null
  // Cursor is now pointing past the end of a shorter list, or at a
  // different picture; either way the next step recomputes it.
  cursor = Math.min(cursor, Math.max(photos.value.length - 1, 0))
  advance()
}

onMounted(async () => {
  // Both are cached reads on the API side, and neither is worth failing the
  // screensaver over: a clock on a black background is a fine fallback.
  const [pool, report] = await Promise.allSettled([photosApi.slideshowPool(POOL_SIZE), weatherApi.report()])

  if (pool.status === 'fulfilled') photos.value = pool.value
  if (report.status === 'fulfilled') weather.value = report.value

  // The first picture goes straight onto the visible layer: there is nothing
  // to fade from.
  const first = photos.value[0]
  if (first) layers.value = [first, null]

  timer = setInterval(advance, Math.max(settings.slideshowSeconds, 3) * 1000)
})

onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
})

/**
 * Dismisses on the press rather than the release, and prevents the default
 * so the tap that woke the screen does not also land as a click on whatever
 * was underneath it.
 */
function onPress(event: Event): void {
  event.preventDefault()
  emit('wake')
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60] cursor-none select-none bg-black"
    role="presentation"
    aria-label="Screensaver — tap to wake"
    @pointerdown="onPress"
  >
    <!-- Crossfade rather than a cut: at this size a hard change catches the
         eye from across the room, which is the opposite of what an idle
         screen should be doing. -->
    <template v-for="(photo, layer) in layers" :key="layer">
      <img
        v-if="photo"
        :src="photo.url"
        alt=""
        decoding="async"
        class="absolute inset-0 size-full object-cover transition-opacity duration-1000"
        :style="{ opacity: active === layer ? 1 : 0 }"
        @load="onLoaded(layer)"
        @error="onFailed(layer)"
      />
    </template>

    <!-- Legible over any photograph: a scrim behind the text rather than a
         text shadow, which disappears against a busy picture. -->
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-10 pt-24 pb-10"
    >
      <div class="min-w-0">
        <p class="text-[clamp(4rem,14vh,9rem)] leading-none font-semibold tabular-nums text-white">{{ time }}</p>
        <p class="mt-2 text-[clamp(1rem,2.4vh,1.75rem)] font-medium text-white/70">{{ date }}</p>
      </div>

      <div v-if="weather" class="flex shrink-0 items-center gap-4 text-white">
        <WeatherIcon :code="weather.current.code" :is-day="weather.current.isDay" :size="64" />
        <div class="text-right">
          <p class="text-[clamp(2rem,7vh,4rem)] leading-none font-semibold tabular-nums">
            {{ Math.round(weather.current.temperature) }}°
          </p>
          <p class="mt-1 text-[clamp(0.875rem,2vh,1.25rem)] text-white/70">{{ weather.location.name }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
