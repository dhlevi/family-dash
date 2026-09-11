import { PostgresDatabase } from '../db/PostgresDatabase'
import type { NewsArticle } from '../types/domain'
import { toIso } from './rows'

interface NewsArticleRow {
  id: string
  feed_id: string
  feed_name: string
  feed_category: string | null
  title: string
  link: string | null
  summary: string | null
  author: string | null
  image_url: string | null
  published_at: Date | null
}

export interface NewArticle {
  guid: string
  title: string
  link: string | null
  summary: string | null
  author: string | null
  imageUrl: string | null
  publishedAt: Date | null
}

export interface ArticleFilter {
  feedId?: string
  category?: string
  /** Only articles with a picture, for the image-led layout. */
  withImagesOnly?: boolean
  limit?: number
}

const COLUMNS =
  'a.id, a.feed_id, f.name AS feed_name, f.category AS feed_category, a.title, a.link, ' +
  'a.summary, a.author, a.image_url, a.published_at'

export class NewsArticleRepository {
  /**
   * Headlines, newest first, from enabled feeds only.
   *
   * Undated articles sort last rather than first: a feed that omits dates
   * should not push today's news off the top of the page.
   */
  public async list(filter: ArticleFilter = {}): Promise<NewsArticle[]> {
    const conditions = ['f.enabled']
    const params: unknown[] = []

    if (filter.feedId) {
      params.push(filter.feedId)
      conditions.push(`a.feed_id = $${params.length}`)
    }

    if (filter.category) {
      params.push(filter.category)
      conditions.push(`f.category = $${params.length}`)
    }

    if (filter.withImagesOnly) conditions.push('a.image_url IS NOT NULL')

    params.push(Math.min(Math.max(filter.limit ?? 40, 1), 200))

    const rows = await PostgresDatabase.many<NewsArticleRow>(
      `SELECT ${COLUMNS}
       FROM news_article a
       JOIN news_feed f ON f.id = a.feed_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.published_at DESC NULLS LAST, a.fetched_at DESC
       LIMIT $${params.length}`,
      params
    )

    return rows.map(NewsArticleRepository.toDomain)
  }

  public async byId(id: string): Promise<NewsArticle | null> {
    const row = await PostgresDatabase.one<NewsArticleRow>(
      `SELECT ${COLUMNS} FROM news_article a JOIN news_feed f ON f.id = a.feed_id WHERE a.id = $1`,
      [id]
    )
    return row ? NewsArticleRepository.toDomain(row) : null
  }

  /**
   * Store a fetch's articles.
   *
   * Upserted on (feed_id, guid), so refetching a feed updates stories in
   * place instead of accumulating copies of the same headline. `fetched_at`
   * is deliberately not touched on conflict.
   */
  public async upsertMany(feedId: string, articles: NewArticle[]): Promise<number> {
    if (articles.length === 0) return 0

    return PostgresDatabase.transaction(async client => {
      let written = 0

      for (const article of articles) {
        const result = await client.query(
          `INSERT INTO news_article (feed_id, guid, title, link, summary, author, image_url, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (feed_id, guid)
           DO UPDATE SET title = excluded.title,
                         link = excluded.link,
                         summary = excluded.summary,
                         author = excluded.author,
                         image_url = excluded.image_url,
                         published_at = excluded.published_at`,
          [
            feedId,
            article.guid,
            article.title,
            article.link,
            article.summary,
            article.author,
            article.imageUrl,
            article.publishedAt
          ]
        )
        written += result.rowCount ?? 0
      }

      return written
    })
  }

  /**
   * Drop articles older than the retention window.
   *
   * Without this the table grows without limit on a machine that is meant to
   * run untouched for months. Undated articles are aged on when we fetched
   * them instead.
   */
  public async prune(retentionDays: number): Promise<number> {
    const days = Math.min(Math.max(retentionDays, 1), 90)

    return PostgresDatabase.execute(
      `DELETE FROM news_article
       WHERE coalesce(published_at, fetched_at) < now() - ($1 || ' days')::interval`,
      [days]
    )
  }

  public async counts(): Promise<{ total: number; withImages: number }> {
    const row = await PostgresDatabase.one<{ total: string; with_images: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE image_url IS NOT NULL)::text AS with_images
       FROM news_article`
    )
    return { total: Number(row?.total ?? 0), withImages: Number(row?.with_images ?? 0) }
  }

  private static toDomain(row: NewsArticleRow): NewsArticle {
    return {
      id: row.id,
      feedId: row.feed_id,
      feedName: row.feed_name,
      feedCategory: row.feed_category,
      title: row.title,
      link: row.link,
      summary: row.summary,
      author: row.author,
      imageUrl: row.image_url,
      publishedAt: toIso(row.published_at)
    }
  }
}
