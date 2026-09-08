<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Field from '@/components/ui/Field.vue'
import TextInput from '@/components/ui/TextInput.vue'
import Spinner from '@/components/ui/Spinner.vue'

/**
 * Adding pictures to the library.
 *
 * Two ways in, because the two live in different places: dragging files on
 * works from a laptop, and the file picker is what a touchscreen has. Both
 * end up in the same album field, which becomes a folder on the volume.
 */
const props = defineProps<{
  open: boolean
  /** Existing album names, offered as suggestions. */
  albums: string[]
  /** Pre-filled when opened from inside an album. */
  defaultAlbum?: string
  uploading: boolean
  error?: string | null
  /** Filenames the API refused on the last attempt, with reasons. */
  rejected?: Array<{ filename: string; reason: string }>
}>()

const emit = defineEmits<{
  close: []
  upload: [files: File[], album: string]
}>()

const ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.avif,.heic,.heif'

const album = ref(props.defaultAlbum ?? '')
const chosen = ref<File[]>([])
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const totalBytes = computed(() => chosen.value.reduce((total, file) => total + file.size, 0))

const summary = computed(() => {
  if (chosen.value.length === 0) return null

  const megabytes = totalBytes.value / (1024 * 1024)
  const size = megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(Math.round(totalBytes.value / 1024), 1)} KB`

  return `${chosen.value.length} ${chosen.value.length === 1 ? 'picture' : 'pictures'} · ${size}`
})

function addFiles(files: FileList | null): void {
  if (!files) return
  // Appended rather than replaced, so a second drop adds to the first.
  chosen.value = [...chosen.value, ...Array.from(files)]
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  addFiles(event.dataTransfer?.files ?? null)
}

function onPick(event: Event): void {
  addFiles((event.target as HTMLInputElement).files)
  // Cleared so picking the same file again still fires a change event.
  ;(event.target as HTMLInputElement).value = ''
}

function removeAt(index: number): void {
  chosen.value = chosen.value.filter((_, position) => position !== index)
}

function submit(): void {
  if (chosen.value.length === 0 || props.uploading) return
  emit('upload', chosen.value, album.value.trim())
}

/** Called by the page once an upload has been accepted. */
function reset(): void {
  chosen.value = []
  dragging.value = false
}

defineExpose({ reset })
</script>

<template>
  <Modal :open="open" title="Add pictures" :busy="uploading" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

      <!-- The drop zone is also the picker button, so there is one target
           whichever input the person has. -->
      <button
        type="button"
        class="flex min-h-40 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors"
        :class="dragging ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong hover:bg-surface-2'"
        :disabled="uploading"
        @click="fileInput?.click()"
        @dragover.prevent="dragging = true"
        @dragenter.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <Icon name="upload" :size="28" class="text-muted" />
        <span class="text-sm font-medium text-ink">Tap to choose pictures, or drop them here</span>
        <span class="text-xs text-faint">JPEG, PNG, WebP, GIF, TIFF, AVIF and HEIC</span>
      </button>

      <input ref="fileInput" type="file" multiple :accept="ACCEPT" class="hidden" @change="onPick" />

      <Field label="Album" hint="A folder on the media volume. Leave empty to add to the top of the library.">
        <TextInput v-model="album" placeholder="Holiday" :disabled="uploading" list="photo-album-names" />
        <datalist id="photo-album-names">
          <option v-for="name in albums.filter(entry => entry.length > 0)" :key="name" :value="name" />
        </datalist>
      </Field>

      <div v-if="chosen.length > 0" class="flex flex-col gap-2">
        <p class="text-xs font-medium text-muted">{{ summary }}</p>

        <ul class="fd-scroll max-h-44 divide-y divide-line rounded-card border border-line">
          <li v-for="(file, index) in chosen" :key="`${file.name}-${index}`" class="flex items-center gap-2 px-3 py-2">
            <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ file.name }}</span>
            <button
              type="button"
              class="grid size-9 shrink-0 place-items-center rounded-card text-faint hover:bg-surface-2 hover:text-danger"
              :aria-label="`Remove ${file.name}`"
              :disabled="uploading"
              @click="removeAt(index)"
            >
              <Icon name="close" :size="15" />
            </button>
          </li>
        </ul>
      </div>

      <div v-if="rejected && rejected.length > 0" class="rounded-card bg-warn/15 px-3 py-2 text-sm">
        <p class="font-medium text-warn">
          {{ rejected.length }} {{ rejected.length === 1 ? 'file was' : 'files were' }} not added
        </p>
        <ul class="mt-1 flex flex-col gap-0.5 text-xs text-muted">
          <li v-for="entry in rejected" :key="entry.filename">{{ entry.filename }} — {{ entry.reason }}</li>
        </ul>
      </div>
    </div>

    <template #actions>
      <button
        type="button"
        class="min-h-11 rounded-card px-4 text-sm font-medium text-muted hover:bg-surface-2"
        :disabled="uploading"
        @click="emit('close')"
      >
        Cancel
      </button>

      <button
        type="button"
        class="flex min-h-11 items-center gap-2 rounded-card bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
        :disabled="uploading || chosen.length === 0"
        @click="submit"
      >
        <Spinner v-if="uploading" :size="16" />
        {{ uploading ? 'Adding…' : `Add ${chosen.length || ''}`.trim() }}
      </button>
    </template>
  </Modal>
</template>
