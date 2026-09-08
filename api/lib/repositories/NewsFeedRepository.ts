import { PostgresDatabase } from '../db/PostgresDatabase'
import type { NewsFeed } from '../types/domain'
import { buildUpdate, toIso } from './rows'

interface NewsFeedRow {
  id: string
  name: string
  url: string
  category: string | null
  enabled: boolean
  last_fetch_at: Date | null
  last_error: string | null
  article_count?: string
}

export interface NewNewsFeed {
  name: string
  url: string
  category?: string | null
  enabled?: boolean
}

export interface NewsFeedUpdate {
  name?: string
  url?: string
  category?: string | null
  enabled?: boolean
}

const COLUMNS = 'id, name, url, category, enabled, last_fetch_at, last_error'

export class NewsFeedRepository {
  public async all(): Promise<NewsFeed[]> {
    const rows = await PostgresDatabase.many<NewsFeedRow>(
      `SELECT ${COLUMNS.split(', ')
        .map(column => `f.${column}`)
        .join(', ')},
              (SELECT count(*)::text FROM news_article a WHERE a.feed_id = f.id) AS article_count
       FROM news_feed f
       ORDER BY f.category NULLS LAST, lower(f.name)`
    )
    return rows.map(NewsFeedRepository.toDomain)
  }

  public async enabled(): Promise<NewsFeed[]> {
    const rows = await PostgresDatabase.many<NewsFeedRow>(
      `SELECT ${COLUMNS} FROM news_feed WHERE enabled ORDER BY lower(name)`
    )
    return rows.map(NewsFeedRepository.toDomain)
  }

  public async byId(id: string): Promise<NewsFeed | null> {
    const row = await PostgresDatabase.one<NewsFeedRow>(`SELECT ${COLUMNS} FROM news_feed WHERE id = $1`, [id])
    return row ? NewsFeedRepository.toDomain(row) : null
  }

  public async byUrl(url: string): Promise<NewsFeed | null> {
    const row = await PostgresDatabase.one<NewsFeedRow>(`SELECT ${COLUMNS} FROM news_feed WHERE url = $1`, [url])
    return row ? NewsFeedRepository.toDomain(row) : null
  }

  public async create(feed: NewNewsFeed): Promise<NewsFeed> {
    const row = await PostgresDatabase.one<NewsFeedRow>(
      `INSERT INTO news_feed (name, url, category, enabled)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [feed.name, feed.url, feed.category ?? null, feed.enabled ?? true]
    )
    return NewsFeedRepository.toDomain(row as NewsFeedRow)
  }

  public async update(id: string, changes: NewsFeedUpdate): Promise<NewsFeed | null> {
    const { clause, params } = buildUpdate(
      {
        name: changes.name,
        url: changes.url,
        category: changes.category,
        enabled: changes.enabled
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<NewsFeedRow>(
      `UPDATE news_feed SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? NewsFeedRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    // Articles cascade with the feed.
    return (await PostgresDatabase.execute('DELETE FROM news_feed WHERE id = $1', [id])) > 0
  }

  /**
   * Record the outcome of a fetch.
   *
   * Storing the error rather than only logging it is what lets the Settings
   * page explain why a feed has gone quiet — a publisher moving a URL is the
   * most common reason headlines stop appearing.
   */
  public async recordFetch(id: string, error: string | null): Promise<void> {
    await PostgresDatabase.execute('UPDATE news_feed SET last_fetch_at = now(), last_error = $2 WHERE id = $1', [
      id,
      error
    ])
  }

  /** Every category in use, for the filter row on the News page. */
  public async categories(): Promise<string[]> {
    const rows = await PostgresDatabase.many<{ category: string }>(
      "SELECT DISTINCT category FROM news_feed WHERE category IS NOT NULL AND category <> '' ORDER BY category"
    )
    return rows.map(row => row.category)
  }

  private static toDomain(row: NewsFeedRow): NewsFeed {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      category: row.category,
      enabled: row.enabled,
      lastFetchAt: toIso(row.last_fetch_at),
      lastError: row.last_error,
      ...(row.article_count !== undefined ? { articleCount: Number(row.article_count) } : {})
    }
  }
}
