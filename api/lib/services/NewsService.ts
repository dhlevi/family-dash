import { RssProvider } from '../providers/news/RssProvider'
import { NewsArticleRepository } from '../repositories/NewsArticleRepository'
import { NewsFeedRepository } from '../repositories/NewsFeedRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import type { NewsFeed } from '../types/domain'

const feeds = new NewsFeedRepository()
const articles = new NewsArticleRepository()
const settings = new SettingRepository()
const provider = new RssProvider()

export interface FetchOutcome {
  feedId: string
  name: string
  articles: number
  error: string | null
  durationMs: number
}

/**
 * Pulling feeds into the local article cache.
 *
 * The UI only ever reads the cache, so the News page opens instantly and
 * keeps showing this morning's headlines when the network drops. One
 * publisher moving a URL takes that feed quiet and records why, rather than
 * emptying the page.
 */
export class NewsService {
  /** Fetch every enabled feed. Never throws for a single feed's failure. */
  public async fetchAll(): Promise<FetchOutcome[]> {
    const enabled = await feeds.enabled()

    if (enabled.length === 0) {
      console.info('No news feeds are enabled')
      return []
    }

    const outcomes: FetchOutcome[] = []

    // Sequentially: a Pi on domestic wifi fetching a dozen feeds at once is
    // slower overall, and politer to the publishers.
    for (const feed of enabled) {
      outcomes.push(await this.fetchOne(feed))
    }

    const pruned = await this.prune()
    const failed = outcomes.filter(outcome => outcome.error !== null)

    console.info(
      `News fetch complete: ${outcomes.length - failed.length}/${outcomes.length} feed(s) ok, ` +
        `${outcomes.reduce((total, outcome) => total + outcome.articles, 0)} article(s) stored, ` +
        `${pruned} pruned`
    )

    return outcomes
  }

  /**
   * Fetch one feed.
   *
   * Records the outcome against the feed either way. A failure leaves the
   * previously cached articles in place — a publisher having a bad afternoon
   * should not blank the headlines.
   */
  public async fetchOne(feed: NewsFeed): Promise<FetchOutcome> {
    const startedAt = Date.now()

    try {
      const { articles: parsed } = await provider.fetch(feed.url)
      const written = await articles.upsertMany(feed.id, parsed)

      await feeds.recordFetch(feed.id, null)

      return {
        feedId: feed.id,
        name: feed.name,
        articles: written,
        error: null,
        durationMs: Date.now() - startedAt
      }
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught)

      await feeds.recordFetch(feed.id, error)
      console.error(`News fetch failed for '${feed.name}': ${error}`)

      return {
        feedId: feed.id,
        name: feed.name,
        articles: 0,
        error,
        durationMs: Date.now() - startedAt
      }
    }
  }

  public async fetchById(id: string): Promise<FetchOutcome | null> {
    const feed = await feeds.byId(id)
    if (!feed) return null

    return this.fetchOne(feed)
  }

  /** Drop articles past the configured retention window. */
  public async prune(): Promise<number> {
    const configured = await settings.get('news.retentionDays')
    const days = typeof configured === 'number' && Number.isFinite(configured) ? configured : 7

    return articles.prune(days)
  }

  /** Validate a feed address before it is saved, and suggest its own title. */
  public async validate(url: string): Promise<{ error: string | null; title: string | null }> {
    return provider.validate(url)
  }
}
