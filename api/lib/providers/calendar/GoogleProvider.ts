import { OUTBOUND_USER_AGENT } from '../userAgent'
import { GoogleOAuth } from './GoogleOAuth'
import type { CalendarProvider } from './CalendarProvider'
import type { CalendarSource, DateRange, ProviderEvent } from '../../types/domain'

/**
 * Google Calendar, through the REST API.
 *
 * One provider among several rather than the foundation, deliberately. A
 * Google OAuth app left in "Testing" mode expires its refresh tokens after
 * seven days, which on a wall display means the calendar silently stops
 * updating a week after somebody set it up, so ICS subscriptions remain the
 * resilient default and this is for the household that wants to write events
 * back to a shared Google calendar.
 *
 * `singleEvents=true` asks Google to expand recurrences into occurrences,
 * which is exactly what the seam wants: the cache stores occurrences, so the
 * calendar grid stays one indexed query.
 */

interface GoogleEventTime {
  /** Set for timed events, with an offset. */
  dateTime?: string
  /** Set for all-day events: a plain 'YYYY-MM-DD'. */
  date?: string
  timeZone?: string
}

interface GoogleEvent {
  id?: string
  iCalUID?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  recurrence?: string[]
}

interface GoogleEventList {
  items?: GoogleEvent[]
  nextPageToken?: string
}

interface GoogleCalendarListEntry {
  id: string
  summary?: string
  primary?: boolean
  accessRole?: string
  backgroundColor?: string
}

export interface GoogleCalendarSummary {
  id: string
  name: string
  primary: boolean
  /** Whether events can be written to it with the granted scopes. */
  writable: boolean
}

const API_BASE = 'https://www.googleapis.com/calendar/v3'

const TIMEOUT_MS = 20000

/** Per page. Google caps this at 2500; 250 keeps each response small. */
const PAGE_SIZE = 250

/** Stop after this many pages, so a pathological calendar cannot spin. */
const MAX_PAGES = 20

export class GoogleProvider implements CalendarProvider {
  public readonly type = 'google' as const
  public readonly writable = true
  public readonly syncable = true

  public async fetch(source: CalendarSource, range: DateRange): Promise<ProviderEvent[]> {
    const { refreshToken, calendarId } = GoogleProvider.configOf(source)

    const events: ProviderEvent[] = []
    let pageToken: string | undefined

    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(PAGE_SIZE),
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString()
      })
      if (pageToken) query.set('pageToken', pageToken)

      const payload = await GoogleProvider.request<GoogleEventList>(
        refreshToken,
        `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`
      )

      for (const item of payload.items ?? []) {
        const event = GoogleProvider.toProviderEvent(item)
        if (event) events.push(event)
      }

      pageToken = payload.nextPageToken
      if (!pageToken) break
    }

    return events
  }

  /** Connected to an account, with a calendar chosen. */
  public isReadyToSync(source: CalendarSource): boolean {
    const refreshToken = typeof source.config.refreshToken === 'string' ? source.config.refreshToken.trim() : ''
    const calendarId = typeof source.config.calendarId === 'string' ? source.config.calendarId.trim() : ''

    return refreshToken.length > 0 && calendarId.length > 0
  }

  public async validateConfig(config: Record<string, unknown>): Promise<string | null> {
    if (!GoogleOAuth.isConfigured()) {
      return 'No Google OAuth client is configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.'
    }

    const refreshToken = typeof config.refreshToken === 'string' ? config.refreshToken.trim() : ''

    // A source can exist before it is connected: Settings creates it, then
    // sends the browser to Google. Nothing to check until there is a token.
    if (refreshToken.length === 0) return null

    const calendarId = typeof config.calendarId === 'string' ? config.calendarId.trim() : ''
    if (calendarId.length === 0) return 'Choose which Google calendar to show'

    try {
      await GoogleProvider.request<GoogleCalendarListEntry>(
        refreshToken,
        `/calendars/${encodeURIComponent(calendarId)}`
      )
    } catch (error) {
      return (error as Error).message
    }

    return null
  }

  /**
   * Creates an event on the Google calendar.
   *
   * Called for events made locally on a writable remote source. All-day
   * events go up as plain dates with an exclusive end, which is how both
   * iCalendar and Google express them, so a birthday does not arrive a day
   * out.
   */
  public async push(source: CalendarSource, event: ProviderEvent): Promise<{ externalUid: string | null }> {
    const { refreshToken, calendarId } = GoogleProvider.configOf(source)

    const body = {
      summary: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: event.allDay
        ? { date: GoogleProvider.toDateOnly(event.startsAt) }
        : { dateTime: event.startsAt.toISOString() },
      end: event.allDay ? { date: GoogleProvider.toDateOnly(event.endsAt) } : { dateTime: event.endsAt.toISOString() }
    }

    const created = await GoogleProvider.request<GoogleEvent>(
      refreshToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(body) }
    )

    return { externalUid: created.id ?? null }
  }

  /** The calendars this connection can see, for the picker in Settings. */
  public static async listCalendars(refreshToken: string): Promise<GoogleCalendarSummary[]> {
    const payload = await GoogleProvider.request<{ items?: GoogleCalendarListEntry[] }>(
      refreshToken,
      '/users/me/calendarList?maxResults=250'
    )

    return (payload.items ?? []).map(entry => ({
      id: entry.id,
      name: entry.summary ?? entry.id,
      primary: entry.primary === true,
      writable: entry.accessRole === 'owner' || entry.accessRole === 'writer'
    }))
  }

  private static configOf(source: CalendarSource): { refreshToken: string; calendarId: string } {
    const refreshToken = typeof source.config.refreshToken === 'string' ? source.config.refreshToken.trim() : ''
    const calendarId = typeof source.config.calendarId === 'string' ? source.config.calendarId.trim() : ''

    if (refreshToken.length === 0) {
      throw new Error(`Calendar source '${source.name}' is not connected to Google yet`)
    }
    if (calendarId.length === 0) {
      throw new Error(`Calendar source '${source.name}' has no Google calendar chosen`)
    }

    return { refreshToken, calendarId }
  }

  private static async request<T>(refreshToken: string, path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await GoogleOAuth.accessTokenFor(refreshToken)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'user-agent': OUTBOUND_USER_AGENT,
          ...init.headers
        },
        signal: controller.signal
      })

      const text = await response.text()

      if (!response.ok) {
        throw new Error(GoogleProvider.describeFailure(response.status, text))
      }

      return (text.length > 0 ? JSON.parse(text) : {}) as T
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Google Calendar did not answer within ${TIMEOUT_MS / 1000}s`, { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Turns a Google error into something a person can act on.
   */
  private static describeFailure(status: number, body: string): string {
    const reason = GoogleProvider.reasonFrom(body)

    if (status === 404) return `Google does not have that calendar any more (${reason || 'not found'})`
    if (status === 403) {
      return `Google refused the request: ${reason || 'forbidden'}. The calendar may no longer be shared with this account.`
    }
    if (status === 401) return 'Google rejected the access token. Reconnect the calendar in Settings.'

    return `Google Calendar request failed (${status}): ${reason || 'no reason given'}`
  }

  /** The human-readable part of a Google error body, if it has one. */
  private static reasonFrom(body: string): string {
    try {
      return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      return body.slice(0, 200)
    }
  }

  /**
   * One occurrence, or null for the ones there is nothing to show for.
   *
   * Cancelled occurrences of a recurring event come back in the list as
   * `status: 'cancelled'` and must be dropped, or a cancelled Tuesday would
   * still appear on the wall.
   */
  private static toProviderEvent(item: GoogleEvent): ProviderEvent | null {
    if (item.status === 'cancelled') return null

    const allDay = item.start?.date !== undefined
    const startsAt = GoogleProvider.toDate(item.start)
    const endsAt = GoogleProvider.toDate(item.end)

    if (!startsAt || !endsAt) return null

    return {
      // The iCalUID is stable across the same event seen through different
      // calendars; the per-occurrence id keeps expanded occurrences distinct.
      externalUid: item.id ?? item.iCalUID ?? null,
      title: item.summary?.trim() || '(no title)',
      description: item.description?.trim() || null,
      location: item.location?.trim() || null,
      startsAt,
      endsAt,
      allDay,
      // Occurrences are already expanded, so no rule is carried through
      // storing one would make the cache expand it a second time.
      rrule: null
    }
  }

  /**
   * A Google time to an instant.
   *
   * An all-day `date` is a calendar day with no timezone. It is anchored to
   * UTC midnight, matching how the ICS provider and the local calendar store
   * all-day events, so the whole calendar renders them the same way.
   */
  private static toDate(time: GoogleEventTime | undefined): Date | null {
    if (!time) return null

    if (time.date) {
      const parsed = new Date(`${time.date}T00:00:00.000Z`)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    if (time.dateTime) {
      const parsed = new Date(time.dateTime)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    return null
  }

  /** The UTC calendar day of an all-day boundary, as Google wants it. */
  private static toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10)
  }
}
