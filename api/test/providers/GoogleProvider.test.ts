import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleProvider } from '../../lib/providers/calendar/GoogleProvider'
import type { CalendarSource } from '../../lib/types/domain'

/**
 * Mapping Google's events onto the shape the cache stores.
 *
 * The two things worth pinning down are the ones that go wrong quietly: an
 * all-day event landing a day out because a plain date was read in local
 * time, and a cancelled occurrence of a weekly event still showing on the
 * wall because it came back in the list like any other.
 */
vi.mock('../../lib/providers/calendar/GoogleOAuth', () => ({
  GoogleOAuth: {
    isConfigured: () => true,
    clientId: () => 'test-client',
    accessTokenFor: async () => 'test-access-token'
  }
}))

const provider = new GoogleProvider()

const source: CalendarSource = {
  id: 'source-1',
  type: 'google',
  name: 'Family (Google)',
  colour: '#4f8ef7',
  enabled: true,
  readOnly: false,
  lastSyncAt: null,
  lastError: null,
  config: { refreshToken: 'refresh-token', calendarId: 'family@group.calendar.google.com' }
}

const range = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') }

/** Captures the requests made, and answers with queued payloads. */
let requests: Array<{ url: string; init: RequestInit }> = []
let responses: unknown[] = []

beforeEach(() => {
  requests = []
  responses = []

  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init })
    const payload = responses.shift() ?? {}

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload)
    } as Response
  })
})

describe('GoogleProvider.fetch', () => {
  it('asks Google to expand recurrences rather than expanding them here', async () => {
    responses.push({ items: [] })
    await provider.fetch(source, range)

    const url = new URL(requests[0]!.url)
    // The cache stores occurrences, so the expansion has to happen upstream.
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('timeMin')).toBe(range.from.toISOString())
    expect(url.searchParams.get('timeMax')).toBe(range.to.toISOString())
    expect(url.pathname).toContain(encodeURIComponent('family@group.calendar.google.com'))
  })

  it('reads a timed event with its offset intact', async () => {
    responses.push({
      items: [
        {
          id: 'event-1',
          summary: 'Swimming',
          location: 'Leisure centre',
          start: { dateTime: '2026-09-08T17:30:00-07:00' },
          end: { dateTime: '2026-09-08T18:30:00-07:00' }
        }
      ]
    })

    const [event] = await provider.fetch(source, range)

    expect(event!.title).toBe('Swimming')
    expect(event!.allDay).toBe(false)
    expect(event!.startsAt.toISOString()).toBe('2026-09-09T00:30:00.000Z')
    expect(event!.location).toBe('Leisure centre')
  })

  it('anchors an all-day event to UTC midnight, so it cannot shift a day', async () => {
    responses.push({
      items: [{ id: 'event-2', summary: "Sam's birthday", start: { date: '2026-09-14' }, end: { date: '2026-09-15' } }]
    })

    const [event] = await provider.fetch(source, range)

    expect(event!.allDay).toBe(true)
    expect(event!.startsAt.toISOString()).toBe('2026-09-14T00:00:00.000Z')
    // Exclusive end, as both iCalendar and Google express it.
    expect(event!.endsAt.toISOString()).toBe('2026-09-15T00:00:00.000Z')
  })

  it('drops a cancelled occurrence instead of showing it', async () => {
    responses.push({
      items: [
        { id: 'weekly-1', summary: 'Bins', start: { date: '2026-09-07' }, end: { date: '2026-09-08' } },
        { id: 'weekly-2', status: 'cancelled', start: { date: '2026-09-14' }, end: { date: '2026-09-15' } }
      ]
    })

    const events = await provider.fetch(source, range)

    expect(events).toHaveLength(1)
    expect(events[0]!.startsAt.toISOString()).toBe('2026-09-07T00:00:00.000Z')
  })

  it('carries no recurrence rule, because the occurrences are already expanded', async () => {
    responses.push({
      items: [
        {
          id: 'event-3',
          summary: 'Weekly shop',
          recurrence: ['RRULE:FREQ=WEEKLY'],
          start: { dateTime: '2026-09-08T10:00:00Z' },
          end: { dateTime: '2026-09-08T11:00:00Z' }
        }
      ]
    })

    const [event] = await provider.fetch(source, range)

    // Keeping the rule would make the cache expand it a second time.
    expect(event!.rrule).toBeNull()
  })

  it('gives an untitled event something to show', async () => {
    responses.push({
      items: [{ id: 'event-4', start: { dateTime: '2026-09-08T10:00:00Z' }, end: { dateTime: '2026-09-08T11:00:00Z' } }]
    })

    const [event] = await provider.fetch(source, range)

    expect(event!.title).toBe('(no title)')
  })

  it('skips an event with no usable times rather than storing an invalid date', async () => {
    responses.push({ items: [{ id: 'event-5', summary: 'Broken', start: {}, end: {} }] })

    expect(await provider.fetch(source, range)).toEqual([])
  })

  it('follows paging until Google stops offering more', async () => {
    responses.push(
      {
        items: [{ id: 'a', summary: 'A', start: { date: '2026-09-02' }, end: { date: '2026-09-03' } }],
        nextPageToken: 'page-2'
      },
      { items: [{ id: 'b', summary: 'B', start: { date: '2026-09-03' }, end: { date: '2026-09-04' } }] }
    )

    const events = await provider.fetch(source, range)

    expect(events.map(event => event.title)).toEqual(['A', 'B'])
    expect(new URL(requests[1]!.url).searchParams.get('pageToken')).toBe('page-2')
  })

  it('refuses to sync a source that has not been connected', async () => {
    const unconnected = { ...source, config: { calendarId: 'x' } }

    await expect(provider.fetch(unconnected, range)).rejects.toThrow(/not connected to Google/)
  })

  it('refuses to sync a connection with no calendar chosen', async () => {
    const unchosen = { ...source, config: { refreshToken: 'refresh-token' } }

    await expect(provider.fetch(unchosen, range)).rejects.toThrow(/no Google calendar chosen/)
  })
})

describe('GoogleProvider.push', () => {
  it('sends a timed event as an instant and returns the id Google gave it', async () => {
    responses.push({ id: 'created-1' })

    const result = await provider.push(source, {
      externalUid: null,
      title: 'Parents evening',
      description: null,
      location: 'School hall',
      startsAt: new Date('2026-09-17T18:00:00Z'),
      endsAt: new Date('2026-09-17T19:00:00Z'),
      allDay: false,
      rrule: null
    })

    expect(result.externalUid).toBe('created-1')
    expect(requests[0]!.init.method).toBe('POST')

    const body = JSON.parse(requests[0]!.init.body as string)
    expect(body.start.dateTime).toBe('2026-09-17T18:00:00.000Z')
    expect(body.start.date).toBeUndefined()
  })

  it('sends an all-day event as plain dates, which is how Google stores them', async () => {
    responses.push({ id: 'created-2' })

    await provider.push(source, {
      externalUid: null,
      title: 'Holiday',
      description: null,
      location: null,
      startsAt: new Date('2026-09-20T00:00:00Z'),
      endsAt: new Date('2026-09-25T00:00:00Z'),
      allDay: true,
      rrule: null
    })

    const body = JSON.parse(requests[0]!.init.body as string)
    expect(body.start).toEqual({ date: '2026-09-20' })
    expect(body.end).toEqual({ date: '2026-09-25' })
  })
})

describe('GoogleProvider error reporting', () => {
  /** Answers with a failure, as Google shapes them. */
  function failWith(status: number, message: string) {
    vi.stubGlobal(
      'fetch',
      async () =>
        ({
          ok: false,
          status,
          text: async () => JSON.stringify({ error: { message } })
        }) as unknown as Response
    )
  }

  it('says the token needs reconnecting on a 401', async () => {
    failWith(401, 'Invalid Credentials')

    await expect(provider.fetch(source, range)).rejects.toThrow(/Reconnect the calendar in Settings/)
  })

  it('points at sharing on a 403, which is what actually causes it', async () => {
    failWith(403, 'Forbidden')

    await expect(provider.fetch(source, range)).rejects.toThrow(/no longer be shared/)
  })

  it('passes through the words Google itself used for anything else', async () => {
    failWith(500, 'Backend Error')

    await expect(provider.fetch(source, range)).rejects.toThrow(/Backend Error/)
  })
})
