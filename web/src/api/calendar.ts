import { api } from './client'
import type {
  CalendarEvent,
  CalendarSource,
  GoogleCalendarStatus,
  GoogleCalendarSummary,
  NewCalendarEvent,
  SyncOutcome
} from './types'

export const calendarApi = {
  // --- sources -------------------------------------------------------------
  sources: () => api.get<CalendarSource[]>('/calendar/sources'),

  addSource: (
    source:
      | { type: 'ics'; name: string; colour?: string; config: { url: string } }
      | { type: 'google'; name: string; colour?: string }
  ) => api.post<CalendarSource>('/calendar/sources', source),

  updateSource: (
    id: string,
    changes: { name?: string; colour?: string; enabled?: boolean; config?: Record<string, unknown> }
  ) => api.patch<CalendarSource>(`/calendar/sources/${id}`, changes),

  deleteSource: (id: string) => api.delete<void>(`/calendar/sources/${id}`),

  /** Fetching a feed can be slow, so this gets a longer leash than the default. */
  syncSource: (id: string) => api.post<SyncOutcome>(`/calendar/sources/${id}/sync`, undefined, { timeoutMs: 60000 }),

  syncAll: () => api.post<SyncOutcome[]>('/calendar/sync', undefined, { timeoutMs: 120000 }),

  // --- google ---------------------------------------------------------------
  googleStatus: () => api.get<GoogleCalendarStatus>('/calendar/google/status'),

  /**
   * The consent URL for a source. The redirect address is worked out by the
   * API from the request, so it is whatever address this browser used.
   */
  googleAuthUrl: (sourceId: string) => api.get<{ url: string }>('/calendar/google/auth-url', { query: { sourceId } }),

  googleCalendars: (sourceId: string) =>
    api.get<GoogleCalendarSummary[]>('/calendar/google/calendars', { query: { sourceId }, timeoutMs: 30000 }),

  googleDisconnect: (sourceId: string) =>
    api.post<CalendarSource>('/calendar/google/disconnect', undefined, { query: { sourceId } }),

  // --- events --------------------------------------------------------------
  /** Events overlapping a range. Reads the API's cache, so it works offline. */
  events: (from: Date, to: Date, sourceId?: string) =>
    api.get<CalendarEvent[]>('/calendar/events', {
      query: { from: from.toISOString(), to: to.toISOString(), sourceId }
    }),

  upcoming: (limit = 8, days?: number) =>
    api.get<CalendarEvent[]>('/calendar/events/upcoming', { query: { limit, days } }),

  addEvent: (event: NewCalendarEvent) => api.post<CalendarEvent>('/calendar/events', event),

  updateEvent: (id: string, changes: Partial<NewCalendarEvent>) =>
    api.patch<CalendarEvent>(`/calendar/events/${id}`, changes),

  deleteEvent: (id: string) => api.delete<void>(`/calendar/events/${id}`)
}
