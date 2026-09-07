import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { IcsProvider } from '../../lib/providers/calendar/IcsProvider'
import type { DateRange, ProviderEvent } from '../../lib/types/domain'

/**
 * ICS parsing is the subtlest code in the project: timezones, all-day
 * semantics, recurrence expansion, excluded dates and modified occurrences
 * all have to be right, and every one of them fails quietly — an event
 * simply shows up at the wrong time on the wall.
 */
const feed = fs.readFileSync(path.resolve(__dirname, '../fixtures/calendar.ics'), 'utf8')

const range: DateRange = {
  from: new Date('2026-09-01T00:00:00Z'),
  to: new Date('2026-10-31T00:00:00Z')
}

const parsed = IcsProvider.parse(feed, range)

function titled(title: string): ProviderEvent[] {
  return parsed.filter(event => event.title === title)
}

describe('IcsProvider.parse', () => {
  it('reads a plain UTC event with its details', () => {
    const [event] = titled('Parent teacher interview')

    expect(event).toBeDefined()
    expect(event?.startsAt.toISOString()).toBe('2026-09-15T17:00:00.000Z')
    expect(event?.endsAt.toISOString()).toBe('2026-09-15T18:30:00.000Z')
    expect(event?.location).toBe('Room 12')
    expect(event?.description).toBe('Bring the reading log')
    expect(event?.allDay).toBe(false)
    expect(event?.rrule).toBeNull()
  })

  it("resolves a TZID against the feed's own VTIMEZONE", () => {
    const [event] = titled('Swim lessons')

    // 17:00 in America/Vancouver on 16 September is PDT (UTC-7), so 00:00Z
    // the next day. Without registering the VTIMEZONE this would come back
    // as 17:00Z and land seven hours early on the display.
    expect(event?.startsAt.toISOString()).toBe('2026-09-17T00:00:00.000Z')
  })

  it('marks a DATE-valued event as all day and keeps its exclusive end', () => {
    const [event] = titled('Pro-D day')

    expect(event?.allDay).toBe(true)
    expect(event?.startsAt.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    // iCalendar DTEND is exclusive for all-day events; preserved as-is.
    expect(event?.endsAt.toISOString()).toBe('2026-09-21T00:00:00.000Z')
  })

  it('expands a recurring event into concrete occurrences', () => {
    const occurrences = titled('Bins out')

    // COUNT=6 weekly from 7 September, minus one EXDATE and one occurrence
    // replaced by a modified instance with a different summary.
    expect(occurrences.length).toBe(4)
    expect(occurrences.every(event => event.rrule?.includes('FREQ=WEEKLY'))).toBe(true)
    expect(occurrences.map(event => event.startsAt.toISOString())).toEqual([
      '2026-09-07T23:00:00.000Z',
      '2026-09-28T23:00:00.000Z',
      '2026-10-05T23:00:00.000Z',
      '2026-10-12T23:00:00.000Z'
    ])
  })

  it('honours EXDATE', () => {
    const starts = titled('Bins out').map(event => event.startsAt.toISOString())

    expect(starts).not.toContain('2026-09-21T23:00:00.000Z')
  })

  it('applies a RECURRENCE-ID override in place of the original occurrence', () => {
    const [modified] = titled('Bins out (early, holiday)')

    expect(modified).toBeDefined()
    expect(modified?.startsAt.toISOString()).toBe('2026-09-14T22:00:00.000Z')
    // ...and the unmodified 14 September occurrence is gone.
    expect(titled('Bins out').map(event => event.startsAt.toISOString())).not.toContain('2026-09-14T23:00:00.000Z')
  })

  it('gives every occurrence of a series the same UID, for the repository to key on', () => {
    const uids = new Set(titled('Bins out').map(event => event.externalUid))

    expect(uids).toEqual(new Set(['weekly@example.com']))
  })

  it('excludes events outside the requested window', () => {
    expect(titled('Way outside the window')).toHaveLength(0)
  })

  it('skips a VEVENT with no UID rather than duplicating it on every sync', () => {
    expect(titled('No UID so cannot be cached')).toHaveLength(0)
  })

  it('returns nothing for a window with no events', () => {
    const empty = IcsProvider.parse(feed, {
      from: new Date('2027-01-01T00:00:00Z'),
      to: new Date('2027-02-01T00:00:00Z')
    })

    expect(empty).toHaveLength(0)
  })

  it('rejects a body that is not a calendar', () => {
    expect(() => IcsProvider.parse('<html>not a calendar</html>', range)).toThrow()
  })

  it('survives a feed containing one malformed event', () => {
    const broken = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//',
      'BEGIN:VEVENT',
      'UID:broken@example.com',
      'SUMMARY:No start date at all',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:fine@example.com',
      'DTSTART:20260915T120000Z',
      'DTEND:20260915T130000Z',
      'SUMMARY:Still parsed',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const events = IcsProvider.parse(broken, range)
    expect(events.map(event => event.title)).toContain('Still parsed')
  })
})

describe('IcsProvider.validateConfig', () => {
  const provider = new IcsProvider()

  it('requires a URL', async () => {
    await expect(provider.validateConfig({})).resolves.toMatch(/required/i)
    await expect(provider.validateConfig({ url: '   ' })).resolves.toMatch(/required/i)
  })

  it('accepts http, https and webcal', async () => {
    await expect(provider.validateConfig({ url: 'https://example.com/a.ics' })).resolves.toBeNull()
    await expect(provider.validateConfig({ url: 'http://nas.local/a.ics' })).resolves.toBeNull()
    // Calendar apps hand out webcal:// links; pasting one should just work.
    await expect(provider.validateConfig({ url: 'webcal://example.com/a.ics' })).resolves.toBeNull()
  })

  it('rejects a non-URL and an unsupported scheme', async () => {
    await expect(provider.validateConfig({ url: 'not a url' })).resolves.toMatch(/URL/i)
    await expect(provider.validateConfig({ url: 'file:///etc/passwd' })).resolves.toMatch(/supported/i)
  })
})
