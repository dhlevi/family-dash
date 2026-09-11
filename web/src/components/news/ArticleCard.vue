<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { formatRelativeDay, formatTime, isSameDay } from '@/utils/datetime'
import type { NewsArticle } from '@/api/types'

/**
 * One headline.
 *
 * Image-led, because a wall display is read at a glance and a picture
 * carries further than a headline does. Text comes from the API already
 * stripped of markup, and is rendered as a text node. Feed content is
 * untrusted input and never becomes HTML.
 */
const props = withDefaults(
  defineProps<{
    article: NewsArticle
    hour24?: boolean
    /** Compact drops the summary, for dense lists and the dashboard. */
    compact?: boolean
  }>(),
  { hour24: true, compact: false }
)

defineEmits<{ open: [article: NewsArticle] }>()

/** A broken remote image should collapse, not leave a torn placeholder. */
const imageFailed = ref(false)

const showImage = computed(() => Boolean(props.article.imageUrl) && !imageFailed.value)

const when = computed(() => {
  if (!props.article.publishedAt) return null

  const date = new Date(props.article.publishedAt)

  return isSameDay(date, new Date())
    ? formatTime(date, props.hour24)
    : `${formatRelativeDay(date)} ${formatTime(date, props.hour24)}`
})
</script>

<template>
  <button
    type="button"
    class="group flex w-full items-start gap-3 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2 active:bg-surface-3"
    @click="$emit('open', article)"
  >
    <!--
      referrerpolicy stops the publisher's CDN learning which dashboard
      requested the picture; lazy loading keeps a long list from fetching
      forty images at once over domestic wifi.
    -->
    <img
      v-if="showImage"
      :src="article.imageUrl ?? undefined"
      :alt="''"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="size-20 shrink-0 rounded-sm bg-surface-2 object-cover"
      @error="imageFailed = true"
    />
    <span v-else class="grid size-20 shrink-0 place-items-center rounded-sm bg-surface-2 text-faint" aria-hidden="true">
      <Icon name="news" :size="24" />
    </span>

    <span class="min-w-0 flex-1">
      <span class="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span class="font-medium text-accent">{{ article.feedName }}</span>
        <span v-if="when" class="text-faint">{{ when }}</span>
        <span v-if="article.author" class="truncate text-faint">· {{ article.author }}</span>
      </span>

      <span class="mt-0.5 block text-base leading-snug font-semibold text-ink">
        {{ article.title }}
      </span>

      <span v-if="!compact && article.summary" class="mt-1 line-clamp-2 block text-sm text-muted">
        {{ article.summary }}
      </span>
    </span>

    <Icon name="chevronRight" :size="18" class="mt-1 shrink-0 text-faint transition-colors group-hover:text-muted" />
  </button>
</template>
