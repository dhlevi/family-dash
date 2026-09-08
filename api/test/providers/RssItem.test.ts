import { describe, expect, it } from 'vitest'
import {
  extractAuthor,
  extractGuid,
  extractImage,
  extractPublishedAt,
  extractSummary,
  stripHtml,
  toArticle,
  truncate,
  type RawRssItem
} from '../../lib/providers/news/RssItem'

/**
 * The shapes here are taken from what three mainstream feeds actually send,
 * sampled while building this — because the interesting failures are not
 * hypothetical, they are "CBC's contentSnippet is empty" and "the Guardian's
 * first image is 140px wide".
 */

/** CBC: image inside HTML content, empty snippet, numeric guid. */
const cbc: RawRssItem = {
  title: "Trump to Bombardier: You can't sell in U.S. unless you build in U.S.",
  link: 'https://www.cbc.ca/news/canada/trump-bombardier-truth-social',
  guid: '1.7500721',
  pubDate: 'Wed, 12 Aug 2026 15:00:00 EDT',
  isoDate: '2026-08-12T19:00:00.000Z',
  contentSnippet: '',
  content:
    "<img src='https://i.cbc.ca/ais/524795c0.jpg?im=Crop' alt='A plane' /><p>The president said " +
    'the aerospace firm would face tariffs unless it moved production.</p>'
}

/** BBC: plain text content, no image anywhere, guid is a URL with a fragment. */
const bbc: RawRssItem = {
  title: "Flight recorders recovered from 'devastating' Amazon cargo plane crash",
  link: 'https://www.bbc.co.uk/news/articles/ce8e32n8epeo?at_medium=R',
  guid: 'https://www.bbc.co.uk/news/articles/ce8e32n8epeo#0',
  isoDate: '2026-09-07T22:23:03.000Z',
  contentSnippet:
    'Five people were killed and five others seriously injured when the Boeing 767-300 overshot the runway.',
  content: 'Five people were killed and five others seriously injured when the Boeing 767-300 overshot the runway.'
}

/** Guardian/NYT shape: several media:content sizes, byline in dc:creator. */
const guardian: RawRssItem = {
  title: 'Storm warning issued for the west coast',
  link: 'https://www.theguardian.com/world/2026/sep/07/storm',
  guid: 'https://www.theguardian.com/world/2026/sep/07/storm',
  isoDate: '2026-09-07T10:00:00.000Z',
  dcCreator: 'Alice Nightingale-Smith',
  description: '<p>Forecasters expect gusts of up to 90mph.</p>',
  mediaContent: [
    { $: { width: '140', url: 'https://i.guim.co.uk/img/small.jpg' } },
    { $: { width: '1000', url: 'https://i.guim.co.uk/img/large.jpg' } },
    { $: { width: '460', url: 'https://i.guim.co.uk/img/medium.jpg' } }
  ]
}

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello   <b>there</b></p>')).toBe('Hello there')
  })

  it('inserts a space at block boundaries so words do not run together', () => {
    // Without this, "<p>One</p><p>Two</p>" becomes "OneTwo".
    expect(stripHtml('<p>One</p><p>Two</p>')).toBe('One Two')
    expect(stripHtml('First<br>Second')).toBe('First Second')
  })

  it('drops script and style bodies rather than exposing their contents', () => {
    // Stripping only the tags would leave the code as visible text.
    expect(stripHtml('<script>alert("x")</script>Safe')).toBe('Safe')
    expect(stripHtml('<style>.a{color:red}</style>Safe')).toBe('Safe')
  })

  it('decodes named and numeric entities', () => {
    expect(stripHtml('Fish &amp; chips')).toBe('Fish & chips')
    expect(stripHtml('&lt;not a tag&gt;')).toBe('<not a tag>')
    expect(stripHtml('caf&#233;')).toBe('café')
    expect(stripHtml('caf&#xe9;')).toBe('café')
    expect(stripHtml('It&rsquo;s here')).toBe('It’s here')
  })

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(stripHtml('&notanentity;')).toBe('&notanentity;')
  })

  it('yields no markup even from a hostile feed', () => {
    // Feed content is untrusted input from the open internet.
    const hostile = '<img src=x onerror="alert(1)"><svg/onload=alert(1)>Headline'

    expect(stripHtml(hostile)).toBe('Headline')
    expect(stripHtml(hostile)).not.toMatch(/[<>]/)
  })

  it('handles empty input', () => {
    expect(stripHtml(undefined)).toBe('')
    expect(stripHtml(null)).toBe('')
    expect(stripHtml('')).toBe('')
  })
})

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('Short', 20)).toBe('Short')
  })

  it('cuts at a word boundary and marks the cut', () => {
    const original = 'The quick brown fox jumps over the lazy dog'
    const result = truncate(original, 20)

    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(21)

    // The kept text must be a whole-word prefix: the original continues with
    // a space where the cut was made, so no word was split.
    const kept = result.slice(0, -1)
    expect(original.startsWith(kept)).toBe(true)
    expect(original[kept.length]).toBe(' ')
  })

  it('falls back to a hard cut when there is no sensible space', () => {
    const result = truncate('a'.repeat(50), 10)

    expect(result).toBe(`${'a'.repeat(10)}…`)
  })
})

describe('extractSummary', () => {
  it("prefers the parser's own snippet", () => {
    expect(extractSummary(bbc)).toContain('Five people were killed')
  })

  it('falls back to stripping HTML content when the snippet is empty', () => {
    // This is CBC: contentSnippet is '' and everything is in `content`.
    const summary = extractSummary(cbc)

    expect(summary).toContain('the aerospace firm would face tariffs')
    expect(summary).not.toMatch(/[<>]/)
  })

  it('uses the description when that is all there is', () => {
    expect(extractSummary(guardian)).toBe('Forecasters expect gusts of up to 90mph.')
  })

  it('returns null when there is nothing to summarise', () => {
    expect(extractSummary({ title: 'Bare' })).toBeNull()
    expect(extractSummary({ title: 'Bare', content: '<p>   </p>' })).toBeNull()
  })
})

describe('extractImage', () => {
  it('picks the widest media:content, not the first', () => {
    // The Guardian lists a 140px thumbnail first; using it would give a
    // blurry card.
    expect(extractImage(guardian)).toBe('https://i.guim.co.uk/img/large.jpg')
  })

  it('finds an image embedded in HTML content', () => {
    expect(extractImage(cbc)).toBe('https://i.cbc.ca/ais/524795c0.jpg?im=Crop')
  })

  it('returns null when a feed carries no image', () => {
    expect(extractImage(bbc)).toBeNull()
  })

  it('uses an enclosure when it is an image', () => {
    expect(extractImage({ enclosure: { url: 'https://example.com/a.jpg', type: 'image/jpeg' } })).toBe(
      'https://example.com/a.jpg'
    )
  })

  it('ignores an enclosure that is not an image', () => {
    // Podcast feeds enclose audio; showing it as a picture is not an option.
    expect(extractImage({ enclosure: { url: 'https://example.com/ep.mp3', type: 'audio/mpeg' } })).toBeNull()
  })

  it('ignores media:content that is explicitly not an image', () => {
    expect(
      extractImage({
        mediaContent: [{ $: { url: 'https://example.com/clip.mp4', medium: 'video', width: '1920' } }]
      })
    ).toBeNull()
  })

  it('accepts media:content with no medium attribute', () => {
    expect(extractImage({ mediaContent: [{ $: { url: 'https://example.com/a.jpg' } }] })).toBe(
      'https://example.com/a.jpg'
    )
  })

  it('falls back to media:thumbnail', () => {
    expect(extractImage({ mediaThumbnail: [{ $: { url: 'https://example.com/thumb.jpg', width: '200' } }] })).toBe(
      'https://example.com/thumb.jpg'
    )
  })

  it('rejects a non-http image reference', () => {
    // A data: or file: URL in a feed is not something to render.
    expect(extractImage({ content: '<img src="data:image/png;base64,AAA">' })).toBeNull()
    expect(extractImage({ enclosure: { url: 'file:///etc/passwd', type: 'image/png' } })).toBeNull()
  })
})

describe('extractGuid', () => {
  it("uses the feed's guid when there is one", () => {
    expect(extractGuid(cbc)).toBe('1.7500721')
  })

  it('falls back to the link', () => {
    expect(extractGuid({ link: 'https://example.com/a', title: 'A' })).toBe('https://example.com/a')
  })

  it('falls back to the title and date, so repeated fetches do not duplicate', () => {
    expect(extractGuid({ title: 'A story', isoDate: '2026-09-07T00:00:00Z' })).toBe('A story|2026-09-07T00:00:00Z')
  })

  it('returns null when the item cannot be identified at all', () => {
    expect(extractGuid({})).toBeNull()
    expect(extractGuid({ title: '   ' })).toBeNull()
  })

  it('bounds the key so a pathological feed cannot blow up the column', () => {
    expect(extractGuid({ guid: 'x'.repeat(2000) })?.length).toBe(500)
  })
})

describe('extractAuthor and extractPublishedAt', () => {
  it('prefers dc:creator, which is where bylines usually live', () => {
    expect(extractAuthor(guardian)).toBe('Alice Nightingale-Smith')
  })

  it('returns null when there is no byline', () => {
    expect(extractAuthor(bbc)).toBeNull()
  })

  it('prefers the ISO date and falls back to pubDate', () => {
    expect(extractPublishedAt(cbc)?.toISOString()).toBe('2026-08-12T19:00:00.000Z')
    expect(extractPublishedAt({ pubDate: 'Wed, 12 Aug 2026 15:00:00 GMT' })?.toISOString()).toBe(
      '2026-08-12T15:00:00.000Z'
    )
  })

  it('returns null for an unparseable or missing date', () => {
    expect(extractPublishedAt({})).toBeNull()
    expect(extractPublishedAt({ pubDate: 'sometime last week' })).toBeNull()
  })
})

describe('toArticle', () => {
  it('assembles a complete article', () => {
    expect(toArticle(guardian)).toMatchObject({
      guid: 'https://www.theguardian.com/world/2026/sep/07/storm',
      title: 'Storm warning issued for the west coast',
      author: 'Alice Nightingale-Smith',
      imageUrl: 'https://i.guim.co.uk/img/large.jpg'
    })
  })

  it('copes with each of the three real feed shapes', () => {
    for (const item of [cbc, bbc, guardian]) {
      const article = toArticle(item)
      expect(article, item.title).not.toBeNull()
      expect(article!.title.length).toBeGreaterThan(0)
    }
  })

  it('rejects an item with no headline', () => {
    expect(toArticle({ guid: 'x', title: '   ' })).toBeNull()
    expect(toArticle({ guid: 'x' })).toBeNull()
  })

  it('keys a title-only item off its title, so refetching does not duplicate it', () => {
    // No guid, no link, no date — the title still gives a key that is stable
    // across fetches, which is what deduplication actually needs.
    const article = toArticle({ title: 'No identity' })

    expect(article?.guid).toBe('No identity|')
    expect(toArticle({ title: 'No identity' })?.guid).toBe(article?.guid)
  })

  it('strips markup out of the title', () => {
    expect(toArticle({ guid: 'x', title: 'A <em>bold</em> claim' })?.title).toBe('A bold claim')
  })
})
