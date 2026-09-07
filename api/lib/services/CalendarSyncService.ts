import { AppProperties } from '../core/AppProperties'
import { CalendarProviderRegistry } from '../providers/calendar'
import { CalendarSourceRepository } from '../repositories/CalendarSourceRepository'
import { EventRepository } from '../repositories/EventRepository'
import type { CalendarSource, DateRange } from '../types/domain'

const sources = new CalendarSourceRepository()
const events = new EventRepository()

export interface SyncOutcome {
  sourceId: string
  name: string
  events: number
  error: string | null
  durationMs: number
}

/**
 * Pulls configured calendar feeds into the local `event` cache.
 *
 * Shared by the scheduled task and the "sync now" button in Settings. The
 * whole point of caching is that the calendar page never waits on somebody
 * else's server, and keeps working when that server is unreachable — so a
 * failure here records itself against the source and leaves the previously
 * cached events alone rather than clearing them.
 */
export class CalendarSyncService {
  /** The window kept cached, relative to now. */
  public static window(): DateRange {
    const pastDays = AppProperties.getNumber('calendar.sync.pastDays', 45)
    const futureDays = AppProperties.getNumber('calendar.sync.futureDays', 365)

    const from = new Date()
    from.setUTCDate(from.getUTCDate() - pastDays)
    from.setUTCHours(0, 0, 0, 0)

    const to = new Date()
    to.setUTCDate(to.getUTCDate() + futureDays)
    to.setUTCHours(23, 59, 59, 999)

    return { from, to }
  }

  /** Sync every enabled source that has an upstream. */
  public async syncAll(): Promise<SyncOutcome[]> {
    const enabled = await sources.enabled()
    const syncable = enabled.filter(source => CalendarProviderRegistry.get(source.type)?.syncable === true)

    if (syncable.length === 0) {
      console.info('No syncable calendar sources are configured')
      return []
    }

    const outcomes: SyncOutcome[] = []

    // Sequentially rather than in parallel: a Pi on domestic wifi fetching a
    // dozen feeds at once is slower overall, not faster.
    for (const source of syncable) {
      outcomes.push(await this.syncOne(source))
    }

    const failed = outcomes.filter(outcome => outcome.error !== null)
    console.info(
      `Calendar sync complete: ${outcomes.length - failed.length}/${outcomes.length} source(s) ok, ` +
        `${outcomes.reduce((total, outcome) => total + outcome.events, 0)} event(s) cached`
    )

    return outcomes
  }

  /**
   * Sync one source.
   *
   * Never throws: the outcome carries the error, which is recorded against
   * the source so the UI can explain why a calendar looks stale. A throw here
   * would abort the remaining sources.
   */
  public async syncOne(source: CalendarSource): Promise<SyncOutcome> {
    const startedAt = Date.now()
    const provider = CalendarProviderRegistry.get(source.type)

    if (!provider) {
      const error = `No provider registered for source type '${source.type}'`
      await sources.recordSync(source.id, error)
      return { sourceId: source.id, name: source.name, events: 0, error, durationMs: Date.now() - startedAt }
    }

    if (!provider.syncable) {
      return { sourceId: source.id, name: source.name, events: 0, error: null, durationMs: 0 }
    }

    const range = CalendarSyncService.window()

    try {
      const fetched = await provider.fetch(source, range)
      const cached = await events.replaceWindow(source.id, range, fetched)

      await sources.recordSync(source.id, null)
      console.info(`Synced calendar '${source.name}': ${cached} event(s)`)

      return { sourceId: source.id, name: source.name, events: cached, error: null, durationMs: Date.now() - startedAt }
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught)

      // The previously cached events stay put. A feed that is down for an
      // afternoon should not blank the calendar on the wall.
      await sources.recordSync(source.id, error)
      console.error(`Calendar sync failed for '${source.name}': ${error}`)

      return { sourceId: source.id, name: source.name, events: 0, error, durationMs: Date.now() - startedAt }
    }
  }
}
