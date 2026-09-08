<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { notesApi } from '@/api/notes'
import EmptyState from '@/components/ui/EmptyState.vue'
import InkRender from '@/components/ink/InkRender.vue'
import WidgetShell from './WidgetShell.vue'
import type { StickyNote } from '@/api/types'

/**
 * Pinned sticky notes.
 *
 * Handwritten notes render with `fit="content"`, which zooms to the writing
 * itself: at widget size the empty paper around a few words would leave
 * nothing readable from across the room.
 */
const notes = ref<StickyNote[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    notes.value = await notesApi.pinned(6)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load notes'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const badge = computed(() => (notes.value.length > 0 ? String(notes.value.length) : null))
</script>

<template>
  <WidgetShell title="Notes" icon="notes" to="/notes" :loading="loading" :error="error" :badge="badge">
    <EmptyState
      v-if="!loading && notes.length === 0"
      icon="notes"
      title="No pinned notes"
      description="Pin a note on the Notes page to show it here."
    />

    <ul v-else class="grid grid-cols-2 gap-2 p-3">
      <li
        v-for="note in notes"
        :key="note.id"
        class="flex min-h-[4.5rem] flex-col overflow-hidden rounded-sm shadow-sm"
        :style="{ backgroundColor: note.colour }"
      >
        <!-- Note paper is a light pastel in both themes, so its text is
             always dark rather than following the theme foreground. -->
        <p
          v-if="note.kind === 'text'"
          class="line-clamp-4 px-2 py-1.5 text-xs leading-snug break-words whitespace-pre-wrap text-[#1a1f2b]"
        >
          {{ note.body }}
        </p>

        <template v-else>
          <div class="min-h-0 flex-1">
            <InkRender
              :strokes="note.strokes"
              :surface-width="note.inkWidth ?? 640"
              :surface-height="note.inkHeight ?? 480"
              fit="content"
            />
          </div>
          <p v-if="note.body" class="truncate px-2 pb-1 text-[0.6875rem] font-medium text-[#1a1f2b]/75">
            {{ note.body }}
          </p>
        </template>
      </li>
    </ul>
  </WidgetShell>
</template>
