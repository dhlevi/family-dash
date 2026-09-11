<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { photosApi } from '@/api/photos'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { albumLabel, type Photo, type PhotoAlbum } from '@/api/types'

/**
 * Chooses a picture from the library, or adds one.
 *
 * Used for recipe photos. Deliberately a picker rather than a second upload
 * path: a recipe's picture is an ordinary library photo, so it can be
 * uploaded once and reused, gets the same thumbnail treatment, and is
 * managed in one place.
 *
 * Not a Modal, because it is opened from inside one nesting two would
 * stack backdrops and trap focus in the wrong layer. It renders inline
 * instead, replacing the field it belongs to while it is open.
 */
const props = defineProps<{
  /** The currently chosen photo id, if any. */
  modelValue: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [id: string | null] }>()

/** How many to offer. A recipe photo is almost always a recent upload. */
const LIMIT = 60

const browsing = ref(false)
const photos = ref<Photo[]>([])
const albums = ref<PhotoAlbum[]>([])
const album = ref<string | undefined>(undefined)
const loading = ref(false)
const error = ref<string | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const chosen = computed(() => photos.value.find(photo => photo.id === props.modelValue) ?? null)

// The chosen photo may not be in the loaded page so it is fetched on its ownto render the preview.
const preview = ref<Photo | null>(null)

async function loadPreview(id: string | null): Promise<void> {
  if (!id) {
    preview.value = null
    return
  }
  if (chosen.value) {
    preview.value = chosen.value
    return
  }

  try {
    preview.value = await photosApi.byId(id)
  } catch {
    // Deleted from the library since it was chosen. The reference is cleared
    // server-side by then, so showing nothing is right.
    preview.value = null
  }
}

watch(() => props.modelValue, loadPreview)
onMounted(() => loadPreview(props.modelValue))

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [list, albumList] = await Promise.all([
      photosApi.list({ album: album.value, limit: LIMIT }),
      photosApi.albums()
    ])

    photos.value = list
    albums.value = albumList
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the photo library'
  } finally {
    loading.value = false
  }
}

async function browse(): Promise<void> {
  browsing.value = true
  await load()
}

async function pickAlbum(name: string | undefined): Promise<void> {
  album.value = name
  await load()
}

function choose(photo: Photo): void {
  emit('update:modelValue', photo.id)
  preview.value = photo
  browsing.value = false
}

function clear(): void {
  emit('update:modelValue', null)
  preview.value = null
}

/**
 * Uploads a new picture and chooses it.
 *
 * Recipe pictures go into a `Recipes` album, so the library stays browsable
 * rather than accumulating loose food photos among the family ones.
 */
async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  uploading.value = true
  error.value = null

  try {
    const outcome = await photosApi.upload([file], 'Recipes')
    const added = outcome.added[0]

    if (added) choose(added)
    else error.value = outcome.rejected[0]?.reason ?? 'That picture could not be added'
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'That picture could not be added'
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

    <!-- Chosen state: the picture, with the two things you can do to it. -->
    <div v-if="preview && !browsing" class="flex items-center gap-3">
      <img :src="preview.thumbUrl" :alt="preview.filename" class="size-20 shrink-0 rounded-card object-cover" />

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-ink">{{ preview.filename }}</p>
        <p class="text-xs text-faint">{{ albumLabel(preview.album) }}</p>
      </div>

      <button
        type="button"
        class="min-h-11 shrink-0 rounded-card px-3 text-sm font-medium text-muted hover:bg-surface-2"
        :disabled="disabled"
        @click="browse"
      >
        Change
      </button>
      <button
        type="button"
        class="grid size-11 shrink-0 place-items-center rounded-card text-faint hover:bg-danger/15 hover:text-danger"
        aria-label="Remove the picture"
        :disabled="disabled"
        @click="clear"
      >
        <Icon name="close" :size="16" />
      </button>
    </div>

    <!-- Nothing chosen: the two ways to get a picture. -->
    <div v-else-if="!browsing" class="flex flex-wrap gap-2">
      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded-card bg-surface-2 px-4 text-sm font-medium text-ink hover:bg-surface-3"
        :disabled="disabled"
        @click="browse"
      >
        <Icon name="photos" :size="16" />
        Choose from the library
      </button>

      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded-card bg-surface-2 px-4 text-sm font-medium text-ink hover:bg-surface-3"
        :disabled="disabled || uploading"
        @click="fileInput?.click()"
      >
        <Spinner v-if="uploading" :size="15" />
        <Icon v-else name="upload" :size="16" />
        {{ uploading ? 'Adding…' : 'Upload one' }}
      </button>
    </div>

    <!-- Browsing the library. -->
    <div v-else class="flex flex-col gap-2 rounded-card border border-line p-2">
      <div class="fd-scroll-x flex items-center gap-1.5">
        <button
          type="button"
          class="min-h-10 shrink-0 rounded-full px-3 text-xs font-medium transition-colors"
          :class="album === undefined ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="pickAlbum(undefined)"
        >
          All
        </button>
        <button
          v-for="entry in albums"
          :key="entry.name || '(loose)'"
          type="button"
          class="min-h-10 shrink-0 rounded-full px-3 text-xs font-medium transition-colors"
          :class="album === entry.name ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="pickAlbum(entry.name)"
        >
          {{ albumLabel(entry.name) }}
        </button>

        <button
          type="button"
          class="ml-auto min-h-10 shrink-0 rounded-card px-3 text-xs font-medium text-muted hover:bg-surface-2"
          @click="browsing = false"
        >
          Cancel
        </button>
      </div>

      <div v-if="loading" class="flex justify-center py-8">
        <Spinner :size="22" />
      </div>

      <EmptyState
        v-else-if="photos.length === 0"
        icon="photos"
        title="No pictures here"
        description="Upload one instead, or add pictures on the Photos page."
      />

      <div v-else class="fd-scroll grid max-h-64 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5">
        <button
          v-for="photo in photos"
          :key="photo.id"
          type="button"
          class="aspect-square overflow-hidden rounded-sm ring-accent transition-all hover:ring-2"
          :class="photo.id === modelValue ? 'ring-2' : ''"
          :aria-label="`Use ${photo.filename}`"
          @click="choose(photo)"
        >
          <img :src="photo.thumbUrl" :alt="photo.filename" loading="lazy" class="size-full object-cover" />
        </button>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.avif,.heic,.heif"
      class="hidden"
      @change="upload"
    />
  </div>
</template>
