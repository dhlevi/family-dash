/**
 * Domain shapes returned by the API.
 *
 * Repositories map database rows (snake_case, SQL types) onto these
 * (camelCase, JSON-friendly). Timestamps are ISO 8601 strings so the wire
 * format is unambiguous; plain dates are 'YYYY-MM-DD'.
 *
 * The Vue client mirrors these in web/src/api/types.ts.
 */

// --- calendar --------------------------------------------------------------

export type CalendarSourceType = 'local' | 'ics' | 'google'

export interface CalendarSource {
  id: string
  type: CalendarSourceType
  name: string
  colour: string
  enabled: boolean
  readOnly: boolean
  lastSyncAt: string | null
  lastError: string | null
  /**
   * Provider-specific configuration: `{ url }` for ics, OAuth details for
   * google, empty for local.
   *
   * An ICS feed URL is itself a bearer secret, but the UI has to show it to
   * be able to edit it, and this API is a LAN appliance with no accounts.
   * OAuth tokens are a different matter and are withheld — see
   * `publicConfig` in CalendarEndpoints.
   */
  config: Record<string, unknown>
}

export interface CalendarEvent {
  id: string
  sourceId: string
  externalUid: string | null
  title: string
  description: string | null
  location: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  rrule: string | null
  colour: string | null
}

/** An event as it exists in a provider, before it has a database identity. */
export interface ProviderEvent {
  externalUid: string | null
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date
  allDay: boolean
  rrule: string | null
}

export interface DateRange {
  from: Date
  to: Date
}

// --- tasks and chores ------------------------------------------------------

export type TaskPriority = 0 | 1 | 2 | 3

export interface TaskItem {
  id: string
  title: string
  notes: string | null
  /** Free text: the household is shared, so this is a name, not a foreign key. */
  assignee: string | null
  category: string | null
  priority: TaskPriority
  dueAt: string | null
  completedAt: string | null
  recurrence: string | null
  createdAt: string
  updatedAt: string
}
