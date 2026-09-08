import { api } from './client'
import type { NewsArticle, NewsFeed, NewsFetchOutcome } from './types'

export const newsApi = {
  /** Headlines from the cache. Count defaults to the Settings preference. */
  articles: (filter: { feedId?: string; category?: string; withImagesOnly?: boolean; limit?: number } = {}) =>
    api.get<NewsArticle[]>('/news', { query: { ...filter } }),

  article: (id: string) => api.get<NewsArticle>(`/news/${id}`),

  feeds: () => api.get<NewsFeed[]>('/news/feeds'),

  categories: () => api.get<string[]>('/news/categories'),

  /** Adding a feed validates and fetches it, so this is not instant. */
  addFeed: (feed: { url: string; name?: string; category?: string | null }) =>
    api.post<NewsFeed>('/news/feeds', feed, { timeoutMs: 45000 }),

  updateFeed: (id: string, changes: { name?: string; url?: string; category?: string | null; enabled?: boolean }) =>
    api.patch<NewsFeed>(`/news/feeds/${id}`, changes, { timeoutMs: 45000 }),

  removeFeed: (id: string) => api.delete<void>(`/news/feeds/${id}`),

  refreshFeed: (id: string) => api.post<NewsFetchOutcome>(`/news/feeds/${id}/refresh`, undefined, { timeoutMs: 45000 }),

  refreshAll: () => api.post<NewsFetchOutcome[]>('/news/refresh', undefined, { timeoutMs: 120000 })
}
