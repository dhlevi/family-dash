import Parser from 'rss-parser'
import { toArticle, type ParsedArticle, type RawRssItem } from './RssItem'
import { OUTBOUND_USER_AGENT } from '../userAgent'

/**
 * Reads an RSS or Atom feed.
 *
 * There is no official Google News API, and every paid aggregator wants an
 * account, but essentially every news organisation still publishes RSS, for
 * free, with no key. That is the whole integration.
 *
 * The custom fields are not decoration: `media:content` and `media:thumbnail`
 * are where most feeds put their images, and `dc:creator` is where they put
 * the byline. Without them, a headline list is text-only.
 */
export class RssProvider {
  public readonly id = 'rss'

  private static readonly TIMEOUT_MS = 20000

  /** A feed longer than this is almost certainly not a news feed. */
  private static readonly MAX_BYTES = 8 * 1024 * 1024

  /** Most feeds carry 20–50 items; more than this is not useful on a wall. */
  private static readonly MAX_ITEMS = 60

  private readonly parser: Parser<Record<string, unknown>, RawRssItem>

  public constructor() {
    this.parser = new Parser<Record<string, unknown>, RawRssItem>({
      timeout: RssProvider.TIMEOUT_MS,
      headers: {
        // Some publishers reject requests without a recognisable agent.
        'user-agent': OUTBOUND_USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      customFields: {
        item: [
          ['media:content', 'mediaContent', { keepArray: true }],
          ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
          ['dc:creator', 'dcCreator'],
          ['description', 'description']
        ]
      }
    })
  }

  /** Fetch and parse a feed into articles, newest first. */
  public async fetch(url: string): Promise<{ title: string | null; articles: ParsedArticle[] }> {
    const body = await RssProvider.download(url)
    const feed = await this.parser.parseString(body)

    const articles = (feed.items ?? [])
      .slice(0, RssProvider.MAX_ITEMS)
      .map(item => toArticle(item))
      // A malformed item is skipped rather than losing the whole feed.
      .filter((article): article is ParsedArticle => article !== null)

    return { title: feed.title ?? null, articles }
  }

  /**
   * Check a feed before it is saved.
   *
   * Returns a readable problem, or the feed's own title on success, which
   * the UI offers as a default name, saving the user from typing one.
   */
  public async validate(url: string): Promise<{ error: string | null; title: string | null }> {
    const trimmed = url.trim()
    if (trimmed.length === 0) return { error: 'A feed address is required', title: null }

    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return { error: 'That does not look like a URL', title: null }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only http and https feed addresses are supported', title: null }
    }

    try {
      const { title, articles } = await this.fetch(trimmed)

      if (articles.length === 0) {
        return { error: 'That address parsed, but contained no readable articles', title }
      }

      return { error: null, title }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), title: null }
    }
  }

  /**
   * Fetched here rather than with the parser's own `parseURL` so the response
   * size can be capped and the failure messages are ours.
   */
  private static async download(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RssProvider.TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': OUTBOUND_USER_AGENT,
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        }
      })

      if (!response.ok) {
        throw new Error(`Feed returned ${response.status} ${response.statusText}`)
      }

      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > RssProvider.MAX_BYTES) {
        throw new Error(`Feed is ${Math.round(declared / 1024 / 1024)}MB, larger than the limit`)
      }

      const body = await response.text()

      if (body.length > RssProvider.MAX_BYTES) throw new Error('Feed is larger than the limit')
      if (!/<(rss|feed|rdf:RDF)\b/i.test(body)) {
        throw new Error('That URL did not return an RSS or Atom feed')
      }

      return body
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Feed did not respond within ${RssProvider.TIMEOUT_MS / 1000}s`, { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
