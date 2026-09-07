import { api } from './client'
import type { CalendarEvent, CalendarSource, NewCalendarEvent, SyncOutcome } from './types'

export const calendarApi = {
  // --- sources -------------------------------------------------------------
  sources: () => api.get<CalendarSource[]>('/calendar/sources'),

  addSource: (source: { type: 'ics'; name: string; colour?: string; config: { url: string } }) =>
    api.post<CalendarSource>('/calendar/sources', source),

  updateSource: (
    id: string,
    changes: { name?: string; colour?: string; enabled?: boolean; config?: Record<string, unknown> }
  ) => api.patch<CalendarSource>(`/calendar/sources/${id}`, changes),

  deleteSource: (id: string) => api.delete<void>(`/calendar/sources/${id}`),

  /** Fetching a feed can be slow, so this gets a longer leash than the default. */
  syncSource: (id: string) => api.post<SyncOutcome>(`/calendar/sources/${id}/sync`, undefined, { timeoutMs: 60000 }),

  syncAll: () => api.post<SyncOutcome[]>('/calendar/sync', undefined, { timeoutMs: 120000 }),

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
