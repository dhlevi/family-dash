import { CalendarProviderRegistry } from '../providers/calendar'
import { CalendarSourceRepository } from '../repositories/CalendarSourceRepository'
import { HealthResult, HealthValidator } from '../core/model/HealthValidator'

const sources = new CalendarSourceRepository()

/**
 * Non-critical probe: is every enabled calendar actually syncing?
 *
 * The calendar page reads a cache, which is what makes it fast and keeps it
 * working through a network outage — and also what makes a broken feed
 * invisible. Events simply stop changing, and a wall display looks the same
 * whether a calendar is up to date or three weeks stale.
 *
 * This is the specific reason Google Calendar needs watching: an OAuth
 * consent screen left in "Testing" expires its refresh tokens after seven
 * days, so a connection set up on a Monday quietly dies the following week.
 * Reporting it here means it shows up in `/healthCheck` and in the Settings
 * diagnostics rather than only in a log nobody reads.
 *
 * Non-critical: a stale calendar is a problem to fix, not a reason for
 * Docker to restart the container.
 */
export class CalendarSourcesCheck implements HealthValidator {
  public readonly name = 'calendar-sources'
  public readonly critical = false

  /** Hours without a successful sync before a source is called stale. */
  private static readonly STALE_AFTER_HOURS = 6

  public async validate(): Promise<HealthResult> {
    const all = await sources.all()

    const watched = all.filter(source => {
      if (!source.enabled || source.type === 'local') return false

      // A calendar somebody is halfway through connecting is not a fault.
      const provider = CalendarProviderRegistry.get(source.type)
      return !provider?.isReadyToSync || provider.isReadyToSync(source)
    })

    if (watched.length === 0) {
      return { healthy: true, detail: { watched: 0, total: all.length } }
    }

    const failing = watched.filter(source => source.lastError !== null)

    const cutoff = Date.now() - CalendarSourcesCheck.STALE_AFTER_HOURS * 3_600_000
    const stale = watched.filter(
      source =>
        source.lastError === null && (source.lastSyncAt === null || new Date(source.lastSyncAt).getTime() < cutoff)
    )

    const problems = [
      ...failing.map(source => `${source.name}: ${source.lastError}`),
      ...stale.map(
        source => `${source.name}: no successful sync in the last ${CalendarSourcesCheck.STALE_AFTER_HOURS}h`
      )
    ]

    return {
      healthy: problems.length === 0,
      message: problems.length > 0 ? problems.join('; ') : undefined,
      detail: {
        watched: watched.length,
        failing: failing.length,
        stale: stale.length,
        sources: watched.map(source => ({
          name: source.name,
          type: source.type,
          lastSyncAt: source.lastSyncAt,
          lastError: source.lastError
        }))
      }
    }
  }
}
