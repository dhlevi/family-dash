<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import QrCode from '@/components/ui/QrCode.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import type { NewsArticle } from '@/api/types'

/**
 * Reading a headline.
 *
 * Deliberately not a link out. The kiosk browser runs in `--kiosk` mode with
 * no address bar and no back button, so following a link would strand the
 * dashboard on a news site with no way home. And a wall in a kitchen is not
 * where anyone reads an article anyway.
 *
 * So: the summary here, and a QR code to carry the story to a phone — the
 * same move as the shopping list, and the right one for a shared display.
 * "Open here" is still offered for anyone using this from a normal browser.
 */
const props = defineProps<{
  open: boolean
  article: NewsArticle | null
  hour24?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

/**
 * A publisher's image can 404 or be blocked. Collapsing the element beats
 * leaving a torn placeholder above the headline. Reset per article, or the
 * next one opens with the previous one's failure.
 */
const imageFailed = ref(false)

watch(
  () => props.article?.id,
  () => {
    imageFailed.value = false
  }
)

const when = computed(() => {
  if (!props.article?.publishedAt) return null

  const date = new Date(props.article.publishedAt)
  return `${formatRelativeDay(date)} at ${formatTime(date, props.hour24 ?? true)}`
})
</script>

<template>
  <Modal :open="open" :title="article?.feedName ?? 'Article'" @close="emit('close')">
    <div v-if="article" class="flex flex-col gap-4">
      <img
        v-if="article.imageUrl && !imageFailed"
        :src="article.imageUrl"
        alt=""
        referrerpolicy="no-referrer"
        class="max-h-56 w-full rounded-card bg-surface-2 object-cover"
        @error="imageFailed = true"
      />

      <div>
        <h3 class="text-xl leading-snug font-semibold text-ink">{{ article.title }}</h3>
        <p class="mt-1 flex flex-wrap gap-x-3 text-xs text-faint">
          <span v-if="when">{{ when }}</span>
          <span v-if="article.author">{{ article.author }}</span>
        </p>
      </div>

      <!-- Plain text from the API; rendered as a text node, never as HTML. -->
      <p v-if="article.summary" class="fd-selectable text-base leading-relaxed text-muted">
        {{ article.summary }}
      </p>
      <p v-else class="text-sm text-faint">This feed does not provide a summary.</p>

      <div v-if="article.link" class="flex flex-col items-center gap-3 rounded-card bg-surface-2 p-4">
        <div class="rounded-card bg-white p-3">
          <QrCode :value="article.link" :size="168" />
        </div>
        <p class="max-w-xs text-center text-sm text-muted">Scan to read the full story on a phone.</p>
      </div>
    </div>

    <template #actions>
      <a
        v-if="article?.link"
        :href="article.link"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex min-h-touch items-center gap-2 rounded-card border border-line px-4 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="chevronRight" :size="16" />
        Open here
      </a>
      <span class="flex-1" />
      <ToolButton label="Done" variant="primary" @click="emit('close')" />
    </template>
  </Modal>
</template>
