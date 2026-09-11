<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { photosApi } from '@/api/photos'
import PhotoTile from '@/components/photos/PhotoTile.vue'
import PhotoUpload from '@/components/photos/PhotoUpload.vue'
import PhotoViewer from '@/components/photos/PhotoViewer.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import PageShell from '@/components/ui/PageShell.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import { albumLabel, type Photo, type PhotoAlbum } from '@/api/types'

/**
 * The photo library.
 *
 * Backed by a folder on the mounted media volume rather than Google Photos,
 * whose Library API can no longer list a user's own library.
 *
 * An app only sees media it uploaded itself, which is useless for showing the
 * family's pictures. So: albums are folders, pictures arrive either through
 * the Add button or by copying them onto the volume, and a background scan keeps
 * the two in sync.
 */

/** How many tiles to fetch at a time. A shelf of holiday photos, roughly. */
const PAGE_SIZE = 120

type Selection = { kind: 'all' } | { kind: 'favourites' } | { kind: 'album'; name: string }

const settings = useSettingsStore()

const albums = ref<PhotoAlbum[]>([])
const photos = ref<Photo[]>([])
const selection = ref<Selection>({ kind: 'all' })

const loading = ref(false)
const loadingMore = ref(false)
const exhausted = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const scanning = ref(false)
const uploadOpen = ref(false)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const rejected = ref<Array<{ filename: string; reason: string }>>([])
const uploader = ref<{ reset: () => void } | null>(null)

/** Index into `photos` of the picture being viewed, or null when browsing. */
const viewing = ref<number | null>(null)

const total = computed(() => albums.value.reduce((sum, album) => sum + album.count, 0))

const albumNames = computed(() => albums.value.map(album => album.name))

const heading = computed(() => {
  if (selection.value.kind === 'favourites') return 'Favourites'
  if (selection.value.kind === 'album') return albumLabel(selection.value.name)
  return 'All pictures'
})

function isSelected(candidate: Selection): boolean {
  if (candidate.kind !== selection.value.kind) return false
  return candidate.kind !== 'album' || candidate.name === (selection.value as { name: string }).name
}

/** The list filter for the current selection. */
function filterFor(current: Selection): { album?: string; favouritesOnly?: boolean } {
  if (current.kind === 'favourites') return { favouritesOnly: true }
  // An empty string for ungrouped files, is passed deliberately rather than treated as "no filter".
  if (current.kind === 'album') return { album: current.name }
  return {}
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [albumList, page] = await Promise.all([
      photosApi.albums(),
      photosApi.list({ ...filterFor(selection.value), limit: PAGE_SIZE })
    ])

    albums.value = albumList
    photos.value = page
    exhausted.value = page.length < PAGE_SIZE
  } catch (caught) {
    error.value = describe(caught, 'Could not load the photo library')
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || exhausted.value) return

  loadingMore.value = true
  try {
    const page = await photosApi.list({
      ...filterFor(selection.value),
      limit: PAGE_SIZE,
      offset: photos.value.length
    })

    photos.value = [...photos.value, ...page]
    exhausted.value = page.length < PAGE_SIZE
  } catch (caught) {
    error.value = describe(caught, 'Could not load more pictures')
  } finally {
    loadingMore.value = false
  }
}

async function select(next: Selection): Promise<void> {
  selection.value = next
  exhausted.value = false
  await load()
}

onMounted(async () => {
  if (!settings.loaded) void settings.load()
  await load()
})

// --- adding ----------------------------------------------------------------

function openUpload(): void {
  uploadError.value = null
  rejected.value = []
  uploadOpen.value = true
}

async function upload(files: File[], album: string): Promise<void> {
  uploading.value = true
  uploadError.value = null
  rejected.value = []

  try {
    const outcome = await photosApi.upload(files, album)

    rejected.value = outcome.rejected
    uploader.value?.reset()

    // Closed only when everything went in; otherwise the modal stays open
    // showing which files were refused and why.
    if (outcome.rejected.length === 0) uploadOpen.value = false

    announce(`Added ${outcome.added.length} ${outcome.added.length === 1 ? 'picture' : 'pictures'}`)

    // Show the album the pictures went into, so they are visible immediately.
    await select(album.length > 0 ? { kind: 'album', name: album } : { kind: 'all' })
  } catch (caught) {
    uploadError.value = describe(caught, 'The pictures could not be added')
    if (caught instanceof ApiRequestError) {
      const details = caught.details as { rejected?: Array<{ filename: string; reason: string }> } | undefined
      rejected.value = details?.rejected ?? []
    }
  } finally {
    uploading.value = false
  }
}

async function rescan(): Promise<void> {
  scanning.value = true
  error.value = null

  try {
    const outcome = await photosApi.scan()
    const parts = [
      outcome.added > 0 ? `${outcome.added} added` : null,
      outcome.removed > 0 ? `${outcome.removed} removed` : null,
      outcome.updated > 0 ? `${outcome.updated} updated` : null,
      outcome.skipped > 0 ? `${outcome.skipped} unreadable` : null
    ].filter(Boolean)

    announce(parts.length > 0 ? `Scan complete: ${parts.join(', ')}` : 'Scan complete: nothing had changed')
    await load()
  } catch (caught) {
    error.value = describe(caught, 'The library could not be scanned')
  } finally {
    scanning.value = false
  }
}

// --- one photo -------------------------------------------------------------

async function setFavourite(photo: Photo, favourite: boolean): Promise<void> {
  // Applied straight away: waiting for a round trip to fill in a star feels
  // broken on a touchscreen.
  const previous = photo.favourite
  patch(photo.id, { favourite })

  try {
    await photosApi.favourite(photo.id, favourite)
  } catch (caught) {
    patch(photo.id, { favourite: previous })
    error.value = describe(caught, 'Could not save that')
  }
}

async function remove(photo: Photo): Promise<void> {
  try {
    await photosApi.remove(photo.id)

    const index = photos.value.findIndex(entry => entry.id === photo.id)
    photos.value = photos.value.filter(entry => entry.id !== photo.id)

    // Keep viewing where the deleted photo was, so a run of deletions works
    // without reopening the viewer each time.
    if (viewing.value !== null) {
      if (photos.value.length === 0) viewing.value = null
      else viewing.value = Math.min(index, photos.value.length - 1)
    }

    albums.value = await photosApi.albums()
    announce(`Deleted ${photo.filename}`)
  } catch (caught) {
    error.value = describe(caught, 'Could not delete that picture')
  }
}

function patch(id: string, changes: Partial<Photo>): void {
  photos.value = photos.value.map(photo => (photo.id === id ? { ...photo, ...changes } : photo))
}

// --- helpers ---------------------------------------------------------------

function announce(message: string): void {
  notice.value = message
  setTimeout(() => (notice.value = null), 4000)
}

function describe(caught: unknown, fallback: string): string {
  return caught instanceof ApiRequestError ? caught.message : fallback
}
</script>

<template>
  <PageShell :padded="false">
    <template #toolbar>
      <div class="fd-scroll-x flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          class="min-h-11 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors"
          :class="isSelected({ kind: 'all' }) ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="select({ kind: 'all' })"
        >
          All<template v-if="total > 0"> ({{ total }})</template>
        </button>

        <button
          type="button"
          class="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors"
          :class="
            isSelected({ kind: 'favourites' }) ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'
          "
          @click="select({ kind: 'favourites' })"
        >
          <Icon name="star" :size="14" />
          Favourites
        </button>

        <span v-if="albums.length > 0" class="mx-1 h-6 w-px shrink-0 bg-line" />

        <button
          v-for="album in albums"
          :key="album.name || '(loose)'"
          type="button"
          class="min-h-11 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors"
          :class="
            isSelected({ kind: 'album', name: album.name })
              ? 'bg-accent text-accent-ink'
              : 'bg-surface-2 text-muted hover:text-ink'
          "
          @click="select({ kind: 'album', name: album.name })"
        >
          {{ albumLabel(album.name) }} ({{ album.count }})
        </button>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <ToolButton icon="refresh" :label="scanning ? 'Scanning…' : 'Rescan'" :disabled="scanning" @click="rescan" />
        <ToolButton icon="plus" label="Add pictures" variant="primary" @click="openUpload" />
      </div>
    </template>

    <p
      v-if="notice"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-4 py-2 text-sm text-ink"
    >
      <Icon name="check" :size="16" />
      {{ notice }}
    </p>

    <p
      v-if="error"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/10 px-4 py-2 text-sm text-danger"
    >
      <Icon name="warning" :size="16" />
      <span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="font-medium underline" @click="error = null">Dismiss</button>
    </p>

    <div class="p-4">
      <div v-if="loading && photos.length === 0" class="flex justify-center py-16">
        <Spinner :size="28">Loading pictures…</Spinner>
      </div>

      <EmptyState
        v-else-if="photos.length === 0 && total === 0"
        icon="photos"
        title="No pictures yet"
        description="Add some with the button above, or copy them into the photos folder on the media volume. A scan runs every hour and picks up whatever is there."
      />

      <EmptyState
        v-else-if="photos.length === 0 && selection.kind === 'favourites'"
        icon="star"
        title="No favourites yet"
        description="Tap the star on a picture to keep it here. Favourites are handy for the slideshow."
      />

      <EmptyState
        v-else-if="photos.length === 0"
        icon="photos"
        :title="`Nothing in ${heading}`"
        description="This album is indexed but empty. A rescan will tidy it up if the files have gone."
      />

      <template v-else>
        <h2 class="mb-3 text-sm font-medium text-muted">
          {{ heading }} · {{ photos.length }} {{ photos.length === 1 ? 'picture' : 'pictures'
          }}<template v-if="!exhausted"> so far</template>
        </h2>

        <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          <PhotoTile
            v-for="(photo, index) in photos"
            :key="photo.id"
            :photo="photo"
            @open="viewing = index"
            @favourite="setFavourite(photo, $event)"
          />
        </div>

        <div v-if="!exhausted" class="mt-4 flex justify-center">
          <button
            type="button"
            class="flex min-h-12 items-center gap-2 rounded-card bg-surface-2 px-5 text-sm font-medium text-ink transition-colors hover:bg-surface-3 disabled:opacity-50"
            :disabled="loadingMore"
            @click="loadMore"
          >
            <Spinner v-if="loadingMore" :size="16" />
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </button>
        </div>
      </template>
    </div>

    <PhotoViewer
      v-if="viewing !== null"
      :photos="photos"
      :index="viewing"
      :interval-seconds="settings.slideshowSeconds"
      :hour24="settings.clock24Hour"
      @update:index="viewing = $event"
      @close="viewing = null"
      @favourite="setFavourite"
      @remove="remove"
    />

    <PhotoUpload
      ref="uploader"
      :open="uploadOpen"
      :albums="albumNames"
      :default-album="selection.kind === 'album' ? selection.name : ''"
      :uploading="uploading"
      :error="uploadError"
      :rejected="rejected"
      @close="uploadOpen = false"
      @upload="upload"
    />
  </PageShell>
</template>
