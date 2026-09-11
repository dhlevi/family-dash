<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { Photo } from '@/api/types'

/**
 * One picture in the album grid.
 *
 * The tile is a square, because a grid of mixed aspect ratios is much harder
 * to scan than a uniform one. The picture is cropped to fill it and shown
 * whole once opened.
 */
const props = defineProps<{ photo: Photo }>()

const emit = defineEmits<{ open: []; favourite: [favourite: boolean] }>()

/**
 * A thumbnail can legitimately be missing: a HEIC whose conversion failed,
 * or a file removed from the volume since the last scan. Showing the
 * filename beats a broken-image glyph nobody can interpret.
 */
const failed = ref(false)

function toggleFavourite(event: Event): void {
  event.stopPropagation()
  emit('favourite', !props.photo.favourite)
}
</script>

<template>
  <div class="group relative aspect-square overflow-hidden rounded-card bg-surface-2">
    <button type="button" class="block size-full" :aria-label="`Open ${photo.filename}`" @click="emit('open')">
      <img
        v-if="!failed"
        :src="photo.thumbUrl"
        :alt="photo.filename"
        loading="lazy"
        decoding="async"
        class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        @error="failed = true"
      />

      <span v-else class="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center">
        <Icon name="photos" :size="22" class="text-faint" />
        <span class="line-clamp-2 text-[11px] leading-tight text-faint">{{ photo.filename }}</span>
      </span>
    </button>

    <!-- Always visible once set, so a favourite reads at a glance; only the
         empty state waits for a hover, to keep the grid quiet. -->
    <button
      type="button"
      class="absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-full bg-black/45 backdrop-blur-sm transition-opacity"
      :class="photo.favourite ? 'text-amber-300' : 'text-white/80 opacity-0 group-hover:opacity-100 focus:opacity-100'"
      :aria-label="photo.favourite ? `Remove ${photo.filename} from favourites` : `Make ${photo.filename} a favourite`"
      :aria-pressed="photo.favourite"
      @click="toggleFavourite"
    >
      <Icon name="star" :size="17" :fill="photo.favourite ? 'currentColor' : 'none'" />
    </button>
  </div>
</template>
