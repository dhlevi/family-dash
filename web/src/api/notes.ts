import { api } from './client'
import type { NewStickyNote, StickyNote } from './types'

export const notesApi = {
  list: () => api.get<StickyNote[]>('/notes'),

  /** Pinned notes only, for the dashboard widget. */
  pinned: (limit = 6) => api.get<StickyNote[]>('/notes', { query: { pinnedOnly: true, limit } }),

  counts: () => api.get<{ total: number; pinned: number }>('/notes/counts'),

  add: (note: NewStickyNote) =>
    // A handwritten note carries its whole stroke list, so it needs more than
    // the default leash on a slow Pi.
    api.post<StickyNote>('/notes', note, { timeoutMs: 30000 }),

  update: (id: string, changes: Partial<NewStickyNote>) =>
    api.patch<StickyNote>(`/notes/${id}`, changes, { timeoutMs: 30000 }),

  /** Raise a note above the rest of the pile. */
  bringToFront: (id: string) => api.post<StickyNote>(`/notes/${id}/front`),

  remove: (id: string) => api.delete<void>(`/notes/${id}`)
}
