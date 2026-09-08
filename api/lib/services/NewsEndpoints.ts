import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { NewsArticleRepository } from '../repositories/NewsArticleRepository'
import { NewsFeedRepository } from '../repositories/NewsFeedRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { NewsService, type FetchOutcome } from './NewsService'
import type { NewsArticle, NewsFeed } from '../types/domain'

const feeds = new NewsFeedRepository()
const articles = new NewsArticleRepository()
const settings = new SettingRepository()
const service = new NewsService()

const newFeedSchema = z.object({
  url: z.string().trim().min(1, 'A feed address is required').max(500),
  name: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).nullish(),
  enabled: z.boolean().optional()
})

const feedUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().trim().min(1).max(500).optional(),
  category: z.string().trim().max(40).nullish(),
  enabled: z.boolean().optional()
})

export class NewsEndpoints {
  // --- articles ------------------------------------------------------------

  /**
   * Headlines from the cache.
   *
   * The default count comes from settings, so how busy the News page looks
   * is a preference rather than a code change.
   */
  public async articles(
    feedId?: string,
    category?: string,
    withImagesOnly?: boolean,
    limit?: number
  ): Promise<NewsArticle[]> {
    const configured = await settings.get('news.maxArticles')
    const fallback = typeof configured === 'number' && Number.isFinite(configured) ? configured : 30

    return articles.list({
      feedId,
      category,
      withImagesOnly,
      limit: limit ?? fallback
    })
  }

  public async article(id: string): Promise<NewsArticle> {
    const article = await articles.byId(id)
    if (!article) throw ApiError.notFound(`No article with id '${id}'`)
    return article
  }

  // --- feeds ---------------------------------------------------------------

  public async feeds(): Promise<NewsFeed[]> {
    return feeds.all()
  }

  public async categories(): Promise<string[]> {
    return feeds.categories()
  }

  /**
   * Add a feed.
   *
   * The address is fetched and parsed before it is saved: catching a wrong
   * URL where somebody typed it is far kinder than letting the first
   * scheduled fetch fail quietly half an hour later. The feed's own title
   * becomes the name when none is given.
   */
  public async addFeed(body: unknown): Promise<NewsFeed> {
    const parsed = newFeedSchema.parse(body)

    const existing = await feeds.byUrl(parsed.url)
    if (existing) throw ApiError.conflict(`That feed is already subscribed as '${existing.name}'`)

    const { error, title } = await service.validate(parsed.url)
    if (error) throw ApiError.unprocessable(error, { field: 'url' })

    const created = await feeds.create({
      url: parsed.url,
      name: parsed.name?.trim() || title?.trim() || parsed.url,
      category: parsed.category?.trim() || null,
      enabled: parsed.enabled
    })

    // A newly added feed should fill immediately rather than sitting empty
    // until the next scheduled fetch.
    void service.fetchOne(created)

    return created
  }

  public async updateFeed(id: string, body: unknown): Promise<NewsFeed> {
    const parsed = feedUpdateSchema.parse(body)
    const existing = await feeds.byId(id)
    if (!existing) throw ApiError.notFound(`No feed with id '${id}'`)

    if (parsed.url && parsed.url !== existing.url) {
      const { error } = await service.validate(parsed.url)
      if (error) throw ApiError.unprocessable(error, { field: 'url' })
    }

    const updated = await feeds.update(id, {
      name: parsed.name,
      url: parsed.url,
      category: parsed.category === undefined ? undefined : parsed.category?.trim() || null,
      enabled: parsed.enabled
    })

    if (!updated) throw ApiError.notFound(`No feed with id '${id}'`)
    return updated
  }

  public async removeFeed(id: string): Promise<void> {
    if (!(await feeds.remove(id))) throw ApiError.notFound(`No feed with id '${id}'`)
  }

  /** Fetch one feed now rather than waiting for the schedule. */
  public async refreshFeed(id: string): Promise<FetchOutcome> {
    const outcome = await service.fetchById(id)
    if (!outcome) throw ApiError.notFound(`No feed with id '${id}'`)

    return outcome
  }

  public async refreshAll(): Promise<FetchOutcome[]> {
    return service.fetchAll()
  }
}
