import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { CalendarProviderRegistry } from '../providers/calendar'
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

    return events.create({
      sourceId: source.id,
      title: parsed.title,
      description: parsed.description ?? null,
      location: parsed.location ?? null,
      startsAt: new Date(parsed.startsAt),
      endsAt: new Date(parsed.endsAt),
      allDay: parsed.allDay ?? false,
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
