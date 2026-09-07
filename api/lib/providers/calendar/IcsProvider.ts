import ICAL from 'ical.js'
import type { CalendarProvider } from './CalendarProvider'
import type { CalendarSource, DateRange, ProviderEvent } from '../../types/domain'

/**
 * Subscribes to an iCalendar (.ics) feed.
 *
 * This is the dependable calendar integration, and the reason the provider
 * seam exists. Google, iCloud and Outlook all publish a secret .ics URL for
 * a calendar: no OAuth client to register, no consent screen, no token to
 * refresh, and nothing that expires after seven days and quietly stops a
 * wall display from updating. The cost is that it is read-only.
 *
 * Recurrences are expanded into concrete occurrences inside the requested
 * window, so the cache holds occurrences rather than rules and the calendar
 * grid stays one indexed range query.
 */
export class IcsProvider implements CalendarProvider {
  public readonly type = 'ics' as const
  public readonly writable = false
  public readonly syncable = true

  /** A feed larger than this is almost certainly not a calendar. */
  private static readonly MAX_BYTES = 12 * 1024 * 1024
  private static readonly TIMEOUT_MS = 20000

  /**
   * Ceiling on occurrences generated from a single recurring event. An
   * unbounded `RRULE:FREQ=DAILY` with a wide window would otherwise generate
   * until the range ends; this stops a malformed rule from pinning the Pi's
   * CPU.
   */
  private static readonly MAX_OCCURRENCES = 1000

  public async fetch(source: CalendarSource, range: DateRange): Promise<ProviderEvent[]> {
    const url = IcsProvider.urlFrom(source.config)
    if (!url) throw new Error(`Calendar source '${source.name}' has no feed URL configured`)

    const body = await IcsProvider.download(url)
    return IcsProvider.parse(body, range)
  }

  public async validateConfig(config: Record<string, unknown>): Promise<string | null> {
    const raw = typeof config.url === 'string' ? config.url.trim() : ''
    if (raw.length === 0) return 'A feed URL is required'

    let url: URL
    try {
      url = new URL(IcsProvider.normalizeScheme(raw))
    } catch {
      return 'That does not look like a URL'
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Only http, https and webcal URLs are supported'
    }

    return null
  }

  /**
   * Calendar apps hand out `webcal://` links, which are ordinary HTTPS URLs
   * with a scheme that tells the OS to open a calendar client. Pasting one in
   * should just work.
   */
  private static normalizeScheme(raw: string): string {
    return raw.replace(/^webcal:\/\//i, 'https://')
  }

  private static urlFrom(config: Record<string, unknown>): string | null {
    const raw = typeof config.url === 'string' ? config.url.trim() : ''
    return raw.length > 0 ? IcsProvider.normalizeScheme(raw) : null
  }

  private static async download(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IcsProvider.TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          accept: 'text/calendar, text/plain, */*',
          'user-agent': 'family-dash/0.1 (+https://github.com/dhlevi/family-dash)'
        }
      })

      if (!response.ok) {
        throw new Error(`Feed returned ${response.status} ${response.statusText}`)
      }

      const declaredLength = Number(response.headers.get('content-length') ?? 0)
      if (declaredLength > IcsProvider.MAX_BYTES) {
        throw new Error(`Feed is ${Math.round(declaredLength / 1024 / 1024)}MB, which is larger than the limit`)
      }

      const body = await response.text()

      // Content-Length is optional, so the real check happens here too.
      if (body.length > IcsProvider.MAX_BYTES) {
        throw new Error('Feed is larger than the limit')
      }
      if (!body.includes('BEGIN:VCALENDAR')) {
        throw new Error('That URL did not return an iCalendar feed')
      }

      return body
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Feed did not respond within ${IcsProvider.TIMEOUT_MS / 1000}s`, { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /** Exposed for testing against fixture feeds without a network round trip. */
  public static parse(body: string, range: DateRange): ProviderEvent[] {
    const component = new ICAL.Component(ICAL.parse(body))

    // Times carrying a TZID cannot be resolved unless the feed's own
    // VTIMEZONE blocks are registered first. Skip this and a 5pm swimming
    // lesson lands at 5pm UTC.
    for (const timezone of component.getAllSubcomponents('vtimezone')) {
      const zone = new ICAL.Timezone(timezone)
      if (!ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone)
    }

    const { masters, exceptions } = IcsProvider.partition(component.getAllSubcomponents('vevent'))

    // A modified occurrence of a recurring event arrives as its own VEVENT
    // carrying RECURRENCE-ID. Relating it to the master makes the iterator
    // yield the modified version rather than the original.
    for (const exception of exceptions) {
      const master = exception.uid ? masters.get(exception.uid) : undefined
      if (master) master.relateException(exception)
    }

    const events: ProviderEvent[] = []
    for (const master of masters.values()) {
      events.push(...IcsProvider.expand(master, range))
    }

    return events
  }

  private static partition(components: ICAL.Component[]): {
    masters: Map<string, ICAL.Event>
    exceptions: ICAL.Event[]
  } {
    const masters = new Map<string, ICAL.Event>()
    const exceptions: ICAL.Event[] = []

    for (const component of components) {
      let event: ICAL.Event
      try {
        event = new ICAL.Event(component)
      } catch {
        // One malformed VEVENT should not lose the rest of the calendar.
        continue
      }

      // A VEVENT with no DTSTART cannot be placed on a calendar, and
      // reading `endDate` off one throws rather than returning null.
      try {
        if (!event.startDate) continue
      } catch {
        continue
      }

      if (component.getFirstPropertyValue('recurrence-id')) exceptions.push(event)
      else if (event.uid) masters.set(event.uid, event)
      // A VEVENT with neither a UID nor a recurrence id cannot be keyed for
      // caching, so it is skipped rather than duplicated on every sync.
    }

    return { masters, exceptions }
  }

  private static expand(event: ICAL.Event, range: DateRange): ProviderEvent[] {
    if (!event.isRecurring()) {
      const single = IcsProvider.toProviderEvent(
        event.uid,
        event.summary,
        event.description,
        event.location,
        event.startDate,
        event.endDate,
        null
      )

      return IcsProvider.overlaps(single, range) ? [single] : []
    }

    const rrule = event.component.getFirstPropertyValue('rrule')
    const rruleText = rrule ? String(rrule) : null

    const occurrences: ProviderEvent[] = []
    const iterator = event.iterator()
    let generated = 0

    for (let next = iterator.next(); next; next = iterator.next()) {
      if (++generated > IcsProvider.MAX_OCCURRENCES) {
        console.warn(`Recurring event '${event.summary}' hit the ${IcsProvider.MAX_OCCURRENCES}-occurrence cap`)
        break
      }

      // The iterator walks forward in time, so once an occurrence starts
      // after the window there is nothing further to find.
      if (next.toJSDate() >= range.to) break

      let details: ReturnType<ICAL.Event['getOccurrenceDetails']>
      try {
        details = event.getOccurrenceDetails(next)
      } catch {
        continue
      }

      const occurrence = IcsProvider.toProviderEvent(
        details.item.uid || event.uid,
        details.item.summary || event.summary,
        details.item.description ?? event.description,
        details.item.location ?? event.location,
        details.startDate,
        details.endDate,
        rruleText
      )

      if (IcsProvider.overlaps(occurrence, range)) occurrences.push(occurrence)
    }

    return occurrences
  }

  private static toProviderEvent(
    uid: string | null,
    summary: string | null,
    description: string | null,
    location: string | null,
    start: ICAL.Time,
    end: ICAL.Time,
    rrule: string | null
  ): ProviderEvent {
    // `isDate` marks a DATE rather than a DATE-TIME, which is how iCalendar
    // expresses an all-day event. Its DTEND is exclusive; that is preserved
    // rather than adjusted, and the UI renders the span accordingly.
    const allDay = start.isDate

    return {
      externalUid: uid,
      title: (summary ?? '').trim() || 'Untitled event',
      description: description?.trim() || null,
      location: location?.trim() || null,
      startsAt: IcsProvider.toJsDate(start),
      endsAt: IcsProvider.toJsDate(end),
      allDay,
      rrule
    }
  }

  /**
   * Converts an iCalendar time to a JavaScript Date.
   *
   * All-day values need special handling: `Time.toJSDate()` treats a DATE as
   * midnight *local* to the server, so a Pro-D day on the 20th would be
   * stored as 07:00Z on the 20th here and render as the 19th for anyone east
   * of UTC. Anchoring to UTC midnight keeps the calendar date the calendar
   * date, whatever timezone the Pi is set to.
   */
  private static toJsDate(time: ICAL.Time): Date {
    if (time.isDate) return new Date(Date.UTC(time.year, time.month - 1, time.day))

    return time.toJSDate()
  }

  private static overlaps(event: ProviderEvent, range: DateRange): boolean {
    return event.startsAt < range.to && event.endsAt >= range.from
  }
}
