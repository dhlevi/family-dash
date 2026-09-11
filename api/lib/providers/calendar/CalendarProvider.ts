import type { CalendarSource, CalendarSourceType, DateRange, ProviderEvent } from '../../types/domain'

/**
 * A source of calendar events.
 *
 * The seam exists because no single calendar integration is dependable
 * enough to build a wall display on. Feed subscriptions never expire but are
 * read-only; Google can be written to but its tokens need care. Keeping them
 * behind one interface means the calendar page merges whatever is configured
 * and does not care which is which.
 *
 * Reads for the UI never come through here. They come from the `event`
 * table, which the background sync keeps filled. `fetch` is called by the
 * sync task alone.
 */
export interface CalendarProvider {
  readonly type: CalendarSourceType

  /** Whether events can be created on sources of this type. */
  readonly writable: boolean

  /** Whether there is an upstream to poll. False for local. */
  readonly syncable: boolean

  /**
   * Pull events from upstream for caching. Implementations should expand
   * recurrences into concrete occurrences inside `range` the cache stores
   * occurrences, not rules, so the calendar grid is a single indexed query.
   */
  fetch(source: CalendarSource, range: DateRange): Promise<ProviderEvent[]>

  /**
   * Validate a source's configuration before it is saved, returning a
   * human-readable problem or null. Catching a bad feed URL at the point
   * somebody types it is much kinder than letting the first sync fail
   * silently an hour later.
   */
  validateConfig?(config: Record<string, unknown>): Promise<string | null>

  /**
   * Whether this source has everything it needs to be synced.
   *
   * A Google calendar exists before it is connected to an account: Settings
   * creates it, then sends the browser off to Google. Syncing one in that
   * state would record a failure every quarter of an hour and report the
   * dashboard as degraded, when nothing is wrong. Providers with nothing to
   * wait for can leave this out.
   */
  isReadyToSync?(source: CalendarSource): boolean

  /**
   * Push a locally created event upstream, returning the id the upstream
   * gave it.
   *
   * Only implemented by writable remote providers. Local events need no
   * push, and feeds cannot accept one. The returned id is stored as the
   * event's `externalUid`, which is what stops the wall display from
   * offering to edit a copy the next sync would overwrite.
   */
  push?(source: CalendarSource, event: ProviderEvent): Promise<{ externalUid: string | null }>
}

/**
 * Providers by source type. Registered at startup in
 * providers/calendar/index.ts.
 */
export class CalendarProviderRegistry {
  private static providers = new Map<CalendarSourceType, CalendarProvider>()

  private constructor() {
    /* static only */
  }

  public static register(...providers: CalendarProvider[]): void {
    for (const provider of providers) {
      CalendarProviderRegistry.providers.set(provider.type, provider)
    }
  }

  public static get(type: CalendarSourceType): CalendarProvider | undefined {
    return CalendarProviderRegistry.providers.get(type)
  }

  public static require(type: CalendarSourceType): CalendarProvider {
    const provider = CalendarProviderRegistry.get(type)
    if (!provider) throw new Error(`No calendar provider is registered for type '${type}'`)
    return provider
  }

  public static types(): CalendarSourceType[] {
    return [...CalendarProviderRegistry.providers.keys()]
  }

  public static reset(): void {
    CalendarProviderRegistry.providers.clear()
  }
}
