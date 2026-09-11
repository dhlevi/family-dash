<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cityArtApi } from '@/api/cityArt'
import { photosApi } from '@/api/photos'
import { weatherApi } from '@/api/weather'
import WeatherIcon from '@/components/weather/WeatherIcon.vue'
import { useClock } from '@/composables/useClock'
import { formatDate, formatTime } from '@/utils/datetime'
import { interleave } from '@/utils/slideshow'
import { useSettingsStore } from '@/stores/settings'
import type { CityArt, Photo, WeatherReport } from '@/api/types'

/**
 * What the display shows when nobody is using it.
 * This will prevent burn in on the screen, as well as provide
 * some entertainment.
 *
 * The picture is either a photograph from the library or a generated map of a
 * city, depending on `appearance.screensaverSource`.
 */
const emit = defineEmits<{ wake: [] }>()

/** How many pictures to cycle. Enough variety for an evening. */
const POOL_SIZE = 40

const settings = useSettingsStore()
const now = useClock()

/** A picture on show, whichever kind it came from. */
interface Slide {
  key: string
  url: string
  /** Present for map artwork; photographs are shown without a label. */
  caption: { title: string; subtitle: string } | null
  /** Painted behind the picture while it loads, so nothing flashes black. */
  background: string
}

const slides = ref<Slide[]>([])
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
 * mid-fade would be stuck at opacity 0.
 */
const layers = ref<[Slide | null, Slide | null]>([null, null])
const active = ref(0)

/** Which layer is loading a picture that has not been shown yet. */
let pending: number | null = null

/** Position in `slides` of whatever is currently on show. */
let cursor = 0

const time = computed(() => formatTime(now.value, settings.clock24Hour))
const date = computed(() => formatDate(now.value))
const current = computed(() => layers.value[active.value])

let timer: ReturnType<typeof setInterval> | null = null

function photoSlide(photo: Photo): Slide {
  return { key: `photo:${photo.id}`, url: photo.url, caption: null, background: '#000000' }
}

function artSlide(art: CityArt): Slide {
  return {
    key: `art:${art.id}`,
    url: art.url,
    caption: { title: art.cityName, subtitle: art.country || art.themeName },
    background: art.background
  }
}

function advance(): void {
  if (slides.value.length < 2) return

  cursor = (cursor + 1) % slides.value.length
  const next = slides.value[cursor]
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
  if (failed) slides.value = slides.value.filter(slide => slide.key !== failed.key)

  pending = null
  // Cursor is now pointing past the end of a shorter list, or at a
  // different picture; either way the next step recomputes it.
  cursor = Math.min(cursor, Math.max(slides.value.length - 1, 0))
  advance()
}

onMounted(async () => {
  const source = settings.screensaverSource
  const wantsPhotos = source === 'gallery' || source === 'both'
  const wantsMaps = source === 'map' || source === 'both'

  // None of these is worth failing the screensaver over: a clock on a plain
  // background is a fine fallback.
  const [pool, art, report] = await Promise.allSettled([
    wantsPhotos ? photosApi.slideshowPool(POOL_SIZE) : Promise.resolve([]),
    wantsMaps ? cityArtApi.pool(POOL_SIZE) : Promise.resolve([]),
    weatherApi.report()
  ])

  const photos = pool.status === 'fulfilled' ? pool.value.map(photoSlide) : []
  const maps = art.status === 'fulfilled' ? art.value.map(artSlide) : []

  if (report.status === 'fulfilled') weather.value = report.value

  slides.value = interleave(photos, maps)

  // Nothing of the chosen kind yet. An empty library, or the first hours of
  // a Pi that has only just been told to draw maps. Rather than show a blank
  // screen, fall back to whatever the other source has.
  if (slides.value.length === 0) {
    const fallback = await Promise.allSettled([
      wantsPhotos ? Promise.resolve([]) : photosApi.slideshowPool(POOL_SIZE),
      wantsMaps ? Promise.resolve([]) : cityArtApi.pool(POOL_SIZE)
    ])

    slides.value = interleave(
      fallback[0].status === 'fulfilled' ? fallback[0].value.map(photoSlide) : [],
      fallback[1].status === 'fulfilled' ? fallback[1].value.map(artSlide) : []
    )
  }

  // The first picture goes straight onto the visible layer: there is nothing
  // to fade from.
  const first = slides.value[0]
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
    class="fixed inset-0 z-[60] cursor-none select-none bg-black transition-colors duration-1000"
    :style="{ backgroundColor: current?.background ?? '#000000' }"
    role="presentation"
    aria-label="Screensaver - tap to wake"
    @pointerdown="onPress"
  >
    <!-- Crossfade rather than a cut: at this size a hard change catches the
         eye from across the room, which is the opposite of what an idle
         screen should be doing. -->
    <template v-for="(slide, layer) in layers" :key="layer">
      <img
        v-if="slide"
        :src="slide.url"
        alt=""
        decoding="async"
        class="absolute inset-0 size-full object-cover transition-opacity duration-1000"
        :style="{ opacity: active === layer ? 1 : 0 }"
        @load="onLoaded(layer)"
        @error="onFailed(layer)"
      />
    </template>

    <!-- Map artwork says where it is. A photograph does not need a label, and
         captioning one would be guessing. -->
    <div
      v-if="current?.caption"
      class="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-10 pt-8 pb-20"
    >
      <p class="text-[clamp(1.5rem,4vh,2.75rem)] leading-none font-semibold text-white">
        {{ current.caption.title }}
      </p>
      <p class="mt-2 text-[clamp(0.8rem,1.8vh,1.1rem)] tracking-wide text-white/60 uppercase">
        {{ current.caption.subtitle }}
      </p>
    </div>

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
