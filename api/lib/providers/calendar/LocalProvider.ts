import type { CalendarProvider } from './CalendarProvider'
import type { CalendarSource, DateRange, ProviderEvent } from '../../types/domain'

/**
 * The household's own calendar.
 *
 * Events are written straight into the `event` table by the API, so there is
 * nothing upstream to poll and `fetch` has nothing to do. The provider still
 * exists so the calendar endpoints can ask the registry "is this source
 * writable?" without special-casing local anywhere.
 */
export class LocalProvider implements CalendarProvider {
  public readonly type = 'local' as const
  public readonly writable = true
  public readonly syncable = false

  public async fetch(_source: CalendarSource, _range: DateRange): Promise<ProviderEvent[]> {
    // Local events are already the authoritative copy in the database.
    return []
  }
}
