<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { newsApi } from '@/api/news'
import ArticleCard from '@/components/news/ArticleCard.vue'
import ArticleReader from '@/components/news/ArticleReader.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import PageShell from '@/components/ui/PageShell.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import type { NewsArticle, NewsFeed } from '@/api/types'

/**
 * Headlines.
 *
 * Reads the API's cache, which the background task fills every half hour, so
 * the page opens instantly and keeps showing this morning's news when the
 * network is down. Filtering by feed or category re-queries rather than
 * filtering in the browser, since the cache holds more than one page's worth.
 */
const settings = useSettingsStore()

const articles = ref<NewsArticle[]>([])
const feeds = ref<NewsFeed[]>([])
const loading = ref(true)
const refreshing = ref(false)
const error = ref<string | null>(null)

/** '' means everything; otherwise a feed id or a `category:` prefix. */
const filter = ref('')

const readerOpen = ref(false)
const reading = ref<NewsArticle | null>(null)

let poller: ReturnType<typeof setInterval> | undefined

async function load(quiet = false): Promise<void> {
  if (!quiet) loading.value = true
  error.value = null

  try {
    const [feedId, category] = filter.value.startsWith('category:')
      ? [undefined, filter.value.slice('category:'.length)]
      : [filter.value || undefined, undefined]

    const [fetchedArticles, fetchedFeeds] = await Promise.all([
      newsApi.articles({ feedId, category }),
      feeds.value.length === 0 ? newsApi.feeds() : Promise.resolve(feeds.value)
    ])

    articles.value = fetchedArticles
    feeds.value = fetchedFeeds
  } catch (caught) {
    if (!quiet) error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the news'
  } finally {
    loading.value = false
  }
}

/** Fetch every feed from its publisher, then reload. */
async function refresh(): Promise<void> {
  refreshing.value = true
  error.value = null

  try {
    const outcomes = await newsApi.refreshAll()
    const failed = outcomes.filter(outcome => outcome.error !== null)

    if (failed.length > 0) {
      error.value = `${failed.length} feed(s) could not be fetched: ${failed
        .map(outcome => `${outcome.name} (${outcome.error})`)
        .join('; ')}`
    }

    feeds.value = await newsApi.feeds()
    await load(true)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not refresh the feeds'
  } finally {
    refreshing.value = false
  }
}

async function applyFilter(next: string): Promise<void> {
  filter.value = next
  await load()
}

onMounted(async () => {
  if (!settings.loaded) void settings.load()
  await load()

  // The cache only changes on the API's own half-hourly schedule.
  poller = setInterval(() => void load(true), 10 * 60 * 1000)
})

onBeforeUnmount(() => {
  if (poller) clearInterval(poller)
})

function openArticle(article: NewsArticle): void {
  reading.value = article
  readerOpen.value = true
}

const categories = computed(() => {
  const names = new Set(feeds.value.filter(feed => feed.enabled && feed.category).map(feed => feed.category as string))
  return [...names].sort()
})

const enabledFeeds = computed(() => feeds.value.filter(feed => feed.enabled))

const failingFeeds = computed(() => feeds.value.filter(feed => feed.enabled && feed.lastError))

/** The most recent successful fetch across all feeds. */
const lastFetched = computed(() => {
  const times = feeds.value
    .map(feed => feed.lastFetchAt)
    .filter((value): value is string => value !== null)
    .map(value => new Date(value).getTime())

  if (times.length === 0) return null

  const at = new Date(Math.max(...times))
  return `${formatRelativeDay(at).toLowerCase()} at ${formatTime(at, settings.clock24Hour)}`
})
</script>

<template>
  <PageShell :padded="false">
    <template #toolbar>
      <div class="fd-scroll-x flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          class="min-h-11 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors"
          :class="filter === '' ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="applyFilter('')"
        >
          All
        </button>

        <button
          v-for="category in categories"
          :key="`category-${category}`"
          type="button"
          class="min-h-11 shrink-0 rounded-full px-3.5 text-sm font-medium capitalize transition-colors"
          :class="
            filter === `category:${category}` ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'
          "
          @click="applyFilter(`category:${category}`)"
        >
          {{ category }}
        </button>

        <span class="mx-1 h-6 w-px shrink-0 bg-line" />

        <button
          v-for="feed in enabledFeeds"
          :key="feed.id"
          type="button"
          class="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors"
          :class="filter === feed.id ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="applyFilter(feed.id)"
        >
          {{ feed.name }}
          <Icon v-if="feed.lastError" name="warning" :size="13" class="text-warn" />
        </button>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <span v-if="lastFetched" class="hidden text-xs text-faint lg:block"> fetched {{ lastFetched }} </span>
        <ToolButton
          icon="refresh"
          :label="refreshing ? 'Fetching…' : 'Refresh'"
          :disabled="refreshing"
          @click="refresh"
        />
      </div>
    </template>

    <p v-if="error" class="flex items-start gap-2 border-b border-line bg-danger/10 px-4 py-2.5 text-sm text-danger">
      <Icon name="warning" :size="16" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="shrink-0 font-medium underline" @click="error = null">Dismiss</button>
    </p>

    <!--
      A failing feed is called out here rather than left to silently stop
      producing headlines — a publisher moving a URL is the usual cause.
    -->
    <p
      v-else-if="failingFeeds.length > 0"
      class="flex items-start gap-2 border-b border-line bg-warn/10 px-4 py-2.5 text-sm text-warn"
    >
      <Icon name="warning" :size="16" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">
        {{ failingFeeds.map(feed => feed.name).join(', ') }}
        {{ failingFeeds.length === 1 ? 'is not responding' : 'are not responding' }}. Older headlines are still shown;
        check the address in Settings.
      </span>
    </p>

    <ErrorState
      v-if="error && articles.length === 0 && !loading"
      :message="error"
      :retrying="refreshing"
      @retry="refresh"
    />

    <div v-else-if="loading && articles.length === 0" class="flex flex-1 items-center justify-center py-16">
      <Spinner :size="28">Loading headlines…</Spinner>
    </div>

    <EmptyState
      v-else-if="articles.length === 0"
      icon="news"
      title="No headlines yet"
      description="Feeds refresh every half hour. Add a feed in Settings, or fetch now with Refresh."
    />

    <div v-else class="fd-scroll min-h-0 flex-1 p-4">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(26rem,1fr))] gap-3">
        <ArticleCard
          v-for="article in articles"
          :key="article.id"
          :article="article"
          :hour24="settings.clock24Hour"
          @open="openArticle"
        />
      </div>

      <p class="py-4 text-center text-xs text-faint">
        {{ articles.length }} {{ articles.length === 1 ? 'headline' : 'headlines' }}
      </p>
    </div>

    <ArticleReader :open="readerOpen" :article="reading" :hour24="settings.clock24Hour" @close="readerOpen = false" />
  </PageShell>
</template>
