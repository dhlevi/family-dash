/**
 * Pulling usable fields out of an RSS item.
 *
 * Feeds agree on almost nothing. Of three mainstream news feeds sampled
 * while building this: the BBC supplies plain-text content and no image at
 * all; CBC supplies an `<img>` buried in HTML content with an empty
 * `contentSnippet`; the Guardian and NYT supply `media:content` in several
 * sizes and put the byline in `dc:creator`. Every one of those shapes is
 * handled here so the rest of the app sees one tidy article.
 *
 * Everything returned is plain text. Feed content is untrusted input from
 * the open internet, so HTML never reaches the database, let alone the
 * browser.
 */

export interface RawRssItem {
  title?: string
  link?: string
  guid?: string
  isoDate?: string
  pubDate?: string
  content?: string
  contentSnippet?: string
  description?: string
  creator?: string
  author?: string
  dcCreator?: string
  enclosure?: { url?: string; type?: string; length?: string }
  /** `media:content`, kept as an array because feeds offer several sizes. */
  mediaContent?: Array<{ $?: Record<string, string> }>
  mediaThumbnail?: Array<{ $?: Record<string, string> }>
}

export interface ParsedArticle {
  guid: string
  title: string
  link: string | null
  summary: string | null
  author: string | null
  imageUrl: string | null
  publishedAt: Date | null
}

/** Longest summary kept. Enough for a headline card, not a whole article. */
const MAX_SUMMARY = 400

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”'
}

/**
 * HTML to plain text.
 *
 * Deliberately not a parser: the aim is to *discard* markup, not to
 * understand it, and the output is only ever inserted as a text node. Script
 * and style bodies are dropped wholesale rather than having their tags
 * stripped, which would otherwise leave their contents as visible text.
 */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return ''

  return (
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      // Turn block boundaries into spaces so words do not run together.
      .replace(/<\/?(p|div|br|li|tr|h[1-6])\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Truncates at a word boundary, so a card never ends mid-word. */
export function truncate(text: string, limit = MAX_SUMMARY): string {
  if (text.length <= limit) return text

  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * The article summary.
 *
 * `contentSnippet` is rss-parser's own de-tagged text and is preferred when
 * it has anything in it but CBC's is empty, so the HTML content and
 * description are stripped as fallbacks.
 */
export function extractSummary(item: RawRssItem): string | null {
  const candidates = [item.contentSnippet, item.description, item.content]

  for (const candidate of candidates) {
    const text = stripHtml(candidate)
    if (text.length > 0) return truncate(text)
  }

  return null
}

/** True for a URL that plausibly points at an image we can display. */
function looksLikeImage(url: string | undefined, mimeType?: string): boolean {
  if (!url || url.trim().length === 0) return false
  if (!/^https?:\/\//i.test(url)) return false
  if (mimeType && !mimeType.toLowerCase().startsWith('image/')) return false

  return true
}

/**
 * The best available image.
 *
 * `media:content` comes first because feeds that offer it usually offer
 * several sizes. The widest is chosen rather than the first. Then thumbnails,
 * then an enclosure, and finally the first `<img>` in the content.
 */
export function extractImage(item: RawRssItem): string | null {
  const fromMedia = widestMedia(item.mediaContent)
  if (fromMedia) return fromMedia

  const fromThumbnail = widestMedia(item.mediaThumbnail)
  if (fromThumbnail) return fromThumbnail

  if (looksLikeImage(item.enclosure?.url, item.enclosure?.type)) {
    return item.enclosure!.url!
  }

  for (const html of [item.content, item.description]) {
    const match = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html ?? '')
    if (match?.[1] && looksLikeImage(match[1])) return match[1]
  }

  return null
}

function widestMedia(entries: RawRssItem['mediaContent']): string | null {
  if (!entries || entries.length === 0) return null

  const images = entries
    .map(entry => entry.$ ?? {})
    .filter(attributes => looksLikeImage(attributes.url, attributes.type))
    // `medium` is sometimes "image" and sometimes absent; only reject it when
    // it explicitly says something else, such as "video".
    .filter(attributes => !attributes.medium || attributes.medium === 'image')

  if (images.length === 0) return null

  const widest = images.reduce((best, candidate) =>
    Number(candidate.width ?? 0) > Number(best.width ?? 0) ? candidate : best
  )

  return widest.url ?? null
}

/**
 * A stable identity for the article.
 *
 * `guid` is the right answer where a feed gives one, but it is optional in
 * the spec: the link, then the title plus its date, stand in. Without a
 * stable key every fetch would insert duplicates of the same story.
 */
export function extractGuid(item: RawRssItem): string | null {
  const guid = item.guid?.trim()
  if (guid && guid.length > 0) return guid.slice(0, 500)

  const link = item.link?.trim()
  if (link && link.length > 0) return link.slice(0, 500)

  const title = item.title?.trim()
  if (title && title.length > 0) {
    return `${title}|${item.isoDate ?? item.pubDate ?? ''}`.slice(0, 500)
  }

  return null
}

export function extractAuthor(item: RawRssItem): string | null {
  const candidates = [item.dcCreator, item.creator, item.author]

  for (const candidate of candidates) {
    const text = stripHtml(candidate)
    if (text.length > 0) return truncate(text, 120)
  }

  return null
}

export function extractPublishedAt(item: RawRssItem): Date | null {
  for (const candidate of [item.isoDate, item.pubDate]) {
    if (!candidate) continue

    const parsed = new Date(candidate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  return null
}

/**
 * One RSS item as an article, or null when it cannot be identified or has no
 * headline.
 */
export function toArticle(item: RawRssItem): ParsedArticle | null {
  const guid = extractGuid(item)
  const title = stripHtml(item.title)

  if (!guid || title.length === 0) return null

  return {
    guid,
    title: truncate(title, 300),
    link: item.link?.trim() || null,
    summary: extractSummary(item),
    author: extractAuthor(item),
    imageUrl: extractImage(item),
    publishedAt: extractPublishedAt(item)
  }
}
