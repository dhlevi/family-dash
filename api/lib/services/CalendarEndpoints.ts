import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { CalendarProviderRegistry, GoogleOAuth, GoogleProvider } from '../providers/calendar'
import type { GoogleCalendarSummary } from '../providers/calendar/GoogleProvider'
import { CalendarSourceRepository } from '../repositories/CalendarSourceRepository'
import { EventRepository } from '../repositories/EventRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { CalendarSyncService, type SyncOutcome } from './CalendarSyncService'
import type { CalendarEvent, CalendarSource } from '../types/domain'

const sources = new CalendarSourceRepository()
const events = new EventRepository()
const settings = new SettingRepository()
const sync = new CalendarSyncService()

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour')

const newSourceSchema = z.object({
  type: z.enum(['local', 'ics', 'google']),
  name: z.string().trim().min(1, 'A name is required').max(80),
  colour: hexColour.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional()
})

const sourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  colour: hexColour.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional()
})

/**
 * Events are given as ISO strings. All-day events are stored with a UTC
 * midnight start and an exclusive end, matching how iCalendar expresses
 * them, so local and subscribed events render identically.
 */
const newEventSchema = z
  .object({
    sourceId: z.string().uuid().optional(),
    title: z.string().trim().min(1, 'A title is required').max(200),
    description: z.string().trim().max(4000).nullish(),
    location: z.string().trim().max(200).nullish(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().optional(),
    colour: hexColour.nullish()
  })
  .refine(event => new Date(event.endsAt) >= new Date(event.startsAt), {
    message: 'The end must not be before the start',
    path: ['endsAt']
  })

const eventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).nullish(),
    location: z.string().trim().max(200).nullish(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    allDay: z.boolean().optional(),
    colour: hexColour.nullish()
  })
  .refine(
    event =>
      event.startsAt === undefined || event.endsAt === undefined || new Date(event.endsAt) >= new Date(event.startsAt),
    { message: 'The end must not be before the start', path: ['endsAt'] }
  )

/** Keys that must never leave the API, whatever a provider stores. */
const SECRET_CONFIG_KEYS = ['refreshToken', 'accessToken', 'clientSecret']

export interface GoogleStatus {
  /** Whether the server has an OAuth client at all. */
  configured: boolean
  /** Not a secret, and useful for confirming which client is in use. */
  clientId: string
  sources: Array<{
    id: string
    name: string
    connected: boolean
    calendarId: string | null
    lastError: string | null
  }>
}

export interface GoogleCallbackResult {
  ok: boolean
  message: string
  sourceId?: string
}

export class CalendarEndpoints {
  // --- sources -------------------------------------------------------------

  public async listSources(): Promise<CalendarSource[]> {
    return (await sources.all()).map(CalendarEndpoints.publicSource)
  }

  public async createSource(body: unknown): Promise<CalendarSource> {
    const parsed = newSourceSchema.parse(body)

    const provider = CalendarProviderRegistry.get(parsed.type)
    if (!provider) {
      throw ApiError.badRequest(`Calendar type '${parsed.type}' is not available`, {
        available: CalendarProviderRegistry.types()
      })
    }

    // Catching a bad feed URL where somebody typed it beats letting the
    // first sync fail quietly an hour later.
    const config = parsed.config ?? {}
    if (provider.validateConfig) {
      const problem = await provider.validateConfig(config)
      if (problem) throw ApiError.unprocessable(problem, { field: 'config' })
    }

    const created = await sources.create({
      type: parsed.type,
      name: parsed.name,
      colour: parsed.colour,
      enabled: parsed.enabled,
      config
    })

    // A newly added feed should populate immediately rather than sitting
    // empty until the next scheduled sync.
    if (provider.syncable && created.enabled) void sync.syncOne(created)

    return CalendarEndpoints.publicSource(created)
  }

  public async updateSource(id: string, body: unknown): Promise<CalendarSource> {
    const parsed = sourceUpdateSchema.parse(body)
    const existing = await sources.byId(id)
    if (!existing) throw ApiError.notFound(`No calendar source with id '${id}'`)

    if (parsed.config !== undefined) {
      const provider = CalendarProviderRegistry.get(existing.type)
      if (provider?.validateConfig) {
        // Merge first: the UI may send only the field it changed, and
        // validating a partial config would reject a perfectly good source.
        const merged = { ...existing.config, ...parsed.config }
        const problem = await provider.validateConfig(merged)
        if (problem) throw ApiError.unprocessable(problem, { field: 'config' })
        parsed.config = merged
      }
    }

    const updated = await sources.update(id, parsed)
    if (!updated) throw ApiError.notFound(`No calendar source with id '${id}'`)

    return CalendarEndpoints.publicSource(updated)
  }

  public async deleteSource(id: string): Promise<void> {
    const existing = await sources.byId(id)
    if (!existing) throw ApiError.notFound(`No calendar source with id '${id}'`)

    if (existing.type === 'local') {
      // Deleting it would take every locally created event with it and leave
      // nowhere to add new ones.
      throw ApiError.conflict('The local family calendar cannot be deleted')
    }

    await sources.remove(id)
  }

  /** Sync one source now. Used by the "sync now" button in Settings. */
  public async syncSource(id: string): Promise<SyncOutcome> {
    const source = await sources.byId(id)
    if (!source) throw ApiError.notFound(`No calendar source with id '${id}'`)

    const provider = CalendarProviderRegistry.get(source.type)
    if (!provider?.syncable) {
      throw ApiError.badRequest(`'${source.name}' has no upstream feed to sync`)
    }

    return sync.syncOne(source)
  }

  public async syncAll(): Promise<SyncOutcome[]> {
    return sync.syncAll()
  }

  // --- google ---------------------------------------------------------------

  /**
   * Whether Google Calendar can be used, and which sources are connected.
   *
   * The Settings page needs to distinguish three states that all look like
   * "it does not work": no OAuth client on the server, a client but no
   * account connected, and connected but no calendar chosen yet.
   */
  public async googleStatus(): Promise<GoogleStatus> {
    const googleSources = (await sources.all()).filter(source => source.type === 'google')

    return {
      configured: GoogleOAuth.isConfigured(),
      clientId: GoogleOAuth.clientId(),
      sources: googleSources.map(source => ({
        id: source.id,
        name: source.name,
        connected: typeof source.config.refreshToken === 'string' && source.config.refreshToken.length > 0,
        calendarId: typeof source.config.calendarId === 'string' ? source.config.calendarId : null,
        lastError: source.lastError
      }))
    }
  }

  /**
   * The URL to send the browser to in order to connect a source.
   *
   * `redirectUri` is derived by the controller from the request's own origin
   * rather than accepted from the caller: only the browser knows how this
   * dashboard was reached, but taking the value from the request instead of
   * the query string means there is nothing here to point somewhere else.
   * It must match what was registered with Google exactly, which is why the
   * README tells you what to register.
   */
  public async googleAuthUrl(sourceId: string, redirectUri: string): Promise<{ url: string }> {
    if (!GoogleOAuth.isConfigured()) {
      throw ApiError.unprocessable(
        'No Google OAuth client is configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart.'
      )
    }

    const source = await sources.byId(sourceId)
    if (!source) throw ApiError.notFound(`No calendar source with id '${sourceId}'`)
    if (source.type !== 'google') throw ApiError.badRequest(`'${source.name}' is not a Google calendar`)

    return { url: GoogleOAuth.beginAuthorization(sourceId, redirectUri).url }
  }

  /**
   * Completes the OAuth handshake, storing the refresh token on the source.
   *
   * Returns a message rather than throwing for the ordinary failures: this
   * is reached by a browser redirect, and a JSON error page is a dead end
   * for somebody standing at a wall display.
   */
  public async googleCallback(code: string | undefined, state: string | undefined): Promise<GoogleCallbackResult> {
    if (!state) return { ok: false, message: 'That authorisation link is missing its state and cannot be used.' }

    const pending = GoogleOAuth.claimAuthorization(state)
    if (!pending) {
      return {
        ok: false,
        message: 'That authorisation has expired or was already used. Start again from Settings.'
      }
    }

    if (!code) return { ok: false, message: 'Google did not return an authorisation code.' }

    const source = await sources.byId(pending.sourceId)
    if (!source) return { ok: false, message: 'The calendar this was for no longer exists.' }

    try {
      const tokens = await GoogleOAuth.exchangeCode(code, pending.redirectUri)

      const calendars = await GoogleProvider.listCalendars(tokens.refreshToken as string)
      // Pre-select the account's own calendar: it is what almost everyone
      // wants, and it saves a second step before anything appears.
      const primary = calendars.find(calendar => calendar.primary) ?? calendars[0]

      await sources.update(pending.sourceId, {
        config: {
          ...source.config,
          refreshToken: tokens.refreshToken,
          calendarId: primary?.id ?? null
        }
      })

      // Fill the calendar immediately rather than leaving it empty until the
      // next scheduled sync.
      const connected = await sources.byId(pending.sourceId)
      if (connected && connected.enabled && primary) void sync.syncOne(connected)

      return { ok: true, message: `Connected to Google as ${primary?.name ?? 'your account'}.`, sourceId: source.id }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  /** The calendars a connected source can see, for the picker in Settings. */
  public async googleCalendars(sourceId: string): Promise<GoogleCalendarSummary[]> {
    const source = await sources.byId(sourceId)
    if (!source) throw ApiError.notFound(`No calendar source with id '${sourceId}'`)

    const refreshToken = typeof source.config.refreshToken === 'string' ? source.config.refreshToken : ''
    if (refreshToken.length === 0) {
      throw ApiError.unprocessable(`'${source.name}' is not connected to Google yet`)
    }

    try {
      return await GoogleProvider.listCalendars(refreshToken)
    } catch (error) {
      throw ApiError.badGateway((error as Error).message)
    }
  }

  /** Forgets the stored tokens, leaving the source in place. */
  public async googleDisconnect(sourceId: string): Promise<CalendarSource> {
    const source = await sources.byId(sourceId)
    if (!source) throw ApiError.notFound(`No calendar source with id '${sourceId}'`)

    const config = { ...source.config }
    delete config.refreshToken
    delete config.accessToken
    delete config.calendarId

    const updated = await sources.update(sourceId, { config })
    if (!updated) throw ApiError.notFound(`No calendar source with id '${sourceId}'`)

    return CalendarEndpoints.publicSource(updated)
  }

  // --- events --------------------------------------------------------------

  /**
   * Events overlapping a range. Reads the cache only, so this is fast and
   * works offline.
   */
  public async listEvents(from?: string, to?: string, sourceId?: string): Promise<CalendarEvent[]> {
    const range = CalendarEndpoints.parseRange(from, to)
    return events.inRange(range, sourceId ? [sourceId] : undefined)
  }

  /** The dashboard's "up next" widget. */
  public async upcoming(limit?: number, days?: number): Promise<CalendarEvent[]> {
    const configuredDays = Number(await settings.get('calendar.dashboardDays')) || 7

    return events.upcoming(Math.min(Math.max(limit ?? 8, 1), 50), Math.min(Math.max(days ?? configuredDays, 1), 90))
  }

  public async createEvent(body: unknown): Promise<CalendarEvent> {
    const parsed = newEventSchema.parse(body)
    const source = await CalendarEndpoints.writableSource(parsed.sourceId)

    const event = {
      externalUid: null as string | null,
      title: parsed.title,
      description: parsed.description ?? null,
      location: parsed.location ?? null,
      startsAt: new Date(parsed.startsAt),
      endsAt: new Date(parsed.endsAt),
      allDay: parsed.allDay ?? false,
      rrule: null
    }

    const provider = CalendarProviderRegistry.require(source.type)

    /**
     * A writable remote calendar is written to first, and only then cached.
     *
     * The sync replaces its whole cached window from upstream, so an event
     * written only locally against a remote source would appear to save and
     * then disappear at the next sync. Pushing first also means a failure is
     * reported instead of being hidden by a local row that is about to be
     * deleted.
     */
    if (provider.push) {
      try {
        const pushed = await provider.push(source, event)
        event.externalUid = pushed.externalUid
      } catch (error) {
        throw ApiError.badGateway(`'${source.name}' would not accept the event: ${(error as Error).message}`)
      }
    }

    return events.create({
      sourceId: source.id,
      externalUid: event.externalUid,
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      colour: parsed.colour ?? null
    })
  }

  public async updateEvent(id: string, body: unknown): Promise<CalendarEvent> {
    const parsed = eventUpdateSchema.parse(body)
    await CalendarEndpoints.assertEditable(id)

    const updated = await events.update(id, {
      title: parsed.title,
      description: parsed.description,
      location: parsed.location,
      startsAt: parsed.startsAt ? new Date(parsed.startsAt) : undefined,
      endsAt: parsed.endsAt ? new Date(parsed.endsAt) : undefined,
      allDay: parsed.allDay,
      colour: parsed.colour
    })

    if (!updated) throw ApiError.notFound(`No event with id '${id}'`)
    return updated
  }

  public async deleteEvent(id: string): Promise<void> {
    await CalendarEndpoints.assertEditable(id)
    await events.remove(id)
  }

  // --- helpers -------------------------------------------------------------

  /**
   * Resolves which source a new event belongs to, defaulting to the local
   * family calendar.
   */
  private static async writableSource(sourceId?: string): Promise<CalendarSource> {
    if (!sourceId) {
      const local = await sources.localSource()
      if (!local) throw ApiError.internal('No local calendar source exists to write to')
      return local
    }

    const source = await sources.byId(sourceId)
    if (!source) throw ApiError.notFound(`No calendar source with id '${sourceId}'`)

    const provider = CalendarProviderRegistry.get(source.type)
    if (source.readOnly || !provider?.writable) {
      throw ApiError.conflict(
        `'${source.name}' is a read-only subscription. Add the event in the calendar that publishes it, ` +
          'or use the family calendar.'
      )
    }

    return source
  }

  /**
   * An event only accepts edits if it was created here. A cached occurrence
   * from a feed would simply reappear unchanged on the next sync, so
   * refusing with an explanation is more honest than accepting the edit.
   */
  private static async assertEditable(id: string): Promise<CalendarEvent> {
    const event = await events.byId(id)
    if (!event) throw ApiError.notFound(`No event with id '${id}'`)

    if (event.externalUid !== null) {
      throw ApiError.conflict(
        'This event comes from a subscribed calendar. Changes would be undone by the next sync, ' +
          'so edit it where it is published.'
      )
    }

    const source = await sources.byId(event.sourceId)
    const provider = source ? CalendarProviderRegistry.get(source.type) : undefined
    if (!source || source.readOnly || !provider?.writable) {
      throw ApiError.conflict('That event belongs to a read-only calendar')
    }

    return event
  }

  /** Defaults to the current month when the caller gives no range. */
  private static parseRange(from?: string, to?: string): { from: Date; to: Date } {
    const now = new Date()
    const start = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const end = to ? new Date(to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

    if (Number.isNaN(start.getTime())) throw ApiError.badRequest(`'from' is not a valid date: ${from}`)
    if (Number.isNaN(end.getTime())) throw ApiError.badRequest(`'to' is not a valid date: ${to}`)
    if (end <= start) throw ApiError.badRequest("'to' must be after 'from'")

    // A three-year span would return tens of thousands of rows to a Pi.
    const maxDays = 400
    if ((end.getTime() - start.getTime()) / 86_400_000 > maxDays) {
      throw ApiError.badRequest(`Requested range is longer than ${maxDays} days`)
    }

    return { from: start, to: end }
  }

  private static publicSource(source: CalendarSource): CalendarSource {
    const config = { ...source.config }
    for (const key of SECRET_CONFIG_KEYS) delete config[key]

    return { ...source, config }
  }
}
