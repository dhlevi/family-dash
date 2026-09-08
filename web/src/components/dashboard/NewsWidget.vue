<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { newsApi } from '@/api/news'
import ArticleCard from '@/components/news/ArticleCard.vue'
import ArticleReader from '@/components/news/ArticleReader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import WidgetShell from './WidgetShell.vue'
import { useSettingsStore } from '@/stores/settings'
import type { NewsArticle } from '@/api/types'

/**
 * The latest few headlines.
 *
 * Tapping one opens the reader here rather than navigating, so somebody
 * walking past can see what a story is about without losing the dashboard.
 */
const settings = useSettingsStore()

const articles = ref<NewsArticle[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const readerOpen = ref(false)
const reading = ref<NewsArticle | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    articles.value = await newsApi.articles({ limit: 6 })
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load headlines'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openArticle(article: NewsArticle): void {
  reading.value = article
  readerOpen.value = true
}

const badge = computed(() => (articles.value.length > 0 ? String(articles.value.length) : null))
</script>

<template>
  <WidgetShell title="Headlines" icon="news" to="/news" :loading="loading" :error="error" :badge="badge">
    <EmptyState
      v-if="!loading && articles.length === 0"
      icon="news"
      title="No headlines yet"
      description="RSS feeds are configured in Settings and refresh in the background."
    />

    <div v-else class="flex flex-col gap-1.5 p-2">
      <ArticleCard
        v-for="article in articles"
        :key="article.id"
        :article="article"
        :hour24="settings.clock24Hour"
        compact
        class="border-transparent bg-transparent p-1.5"
        @open="openArticle"
      />
    </div>

    <ArticleReader :open="readerOpen" :article="reading" :hour24="settings.clock24Hour" @close="readerOpen = false" />
  </WidgetShell>
</template>
