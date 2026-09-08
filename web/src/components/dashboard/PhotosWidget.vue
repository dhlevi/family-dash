<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { photosApi } from '@/api/photos'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useSettingsStore } from '@/stores/settings'
import WidgetShell from './WidgetShell.vue'
import type { Photo } from '@/api/types'

/**
 * A slowly cycling picture from the library.
 *
 * Favourites first, because this is the widget that sits on the wall all day
 * and nobody wants to curate it — starring a handful of pictures is the
 * whole configuration. Falls back to the newest photos if nothing has been
 * starred, so a fresh library still shows something.
 *
 * Only the thumbnail is fetched. A full-size picture would be several
 * megabytes for a tile a few hundred pixels wide, and it is the dashboard
 * that has to stay light.
 */

/** How many to cycle through. Enough for variety, few enough to prefetch. */
const POOL_SIZE = 24

const settings = useSettingsStore()

const photos = ref<Photo[]>([])
const index = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)
const failedIds = ref(new Set<string>())

const current = computed<Photo | undefined>(() => photos.value[index.value])

const badge = computed(() => (photos.value.length > 1 ? `${index.value + 1}/${photos.value.length}` : null))

let timer: ReturnType<typeof setInterval> | null = null

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const favourites = await photosApi.list({ favouritesOnly: true, limit: POOL_SIZE })

    photos.value = favourites.length > 0 ? favourites : await photosApi.list({ limit: POOL_SIZE })

    index.value = 0
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load photos'
  } finally {
    loading.value = false
  }
}

function advance(): void {
  if (photos.value.length < 2) return
  index.value = (index.value + 1) % photos.value.length
}

onMounted(async () => {
  await load()

  // Four times the slideshow interval: the full-screen slideshow is
  // something somebody chose to watch, while this is background furniture,
  // and a tile changing every twenty seconds in the corner of a kitchen is
  // a distraction rather than a feature.
  const seconds = Math.max(settings.slideshowSeconds, 5) * 4
  timer = setInterval(advance, seconds * 1000)
})

onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
})

/**
 * A thumbnail that will not load is dropped from the pool rather than left
 * to show a gap every time it comes round.
 */
function onFailed(photo: Photo): void {
  failedIds.value.add(photo.id)
  photos.value = photos.value.filter(entry => !failedIds.value.has(entry.id))
  if (index.value >= photos.value.length) index.value = 0
}
</script>

<template>
  <WidgetShell title="Photos" icon="photos" to="/photos" :loading="loading" :error="error" :badge="badge">
    <EmptyState
      v-if="!loading && photos.length === 0"
      icon="photos"
      title="No photos yet"
      description="Add pictures on the Photos page, or copy them onto the media volume."
    />

    <RouterLink v-else-if="current" to="/photos" class="relative block min-h-0 flex-1 bg-surface-2">
      <img
        :key="current.id"
        :src="current.thumbUrl"
        :alt="current.filename"
        decoding="async"
        class="size-full object-cover"
        @error="onFailed(current)"
      />

      <!-- Caption over the picture: the tile is small and a separate row
           would take height the photo needs more. -->
      <span
        class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-1.5 text-[11px] font-medium text-white"
      >
        {{ current.album || current.filename }}
      </span>
    </RouterLink>
  </WidgetShell>
</template>
