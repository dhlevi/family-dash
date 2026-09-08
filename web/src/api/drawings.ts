import { api } from './client'
import type { Drawing, NewDrawing } from './types'

export const drawingsApi = {
  /** Most recently worked on first. Strokes are included, for thumbnails. */
  list: (limit = 60) => api.get<Drawing[]>('/drawings', { query: { limit } }),

  get: (id: string) => api.get<Drawing>(`/drawings/${id}`),

  // A full page of strokes is a bigger payload than the default leash allows
  // for on a slow Pi.
  add: (drawing: NewDrawing) => api.post<Drawing>('/drawings', drawing, { timeoutMs: 45000 }),

  update: (id: string, changes: Partial<NewDrawing>) =>
    api.patch<Drawing>(`/drawings/${id}`, changes, { timeoutMs: 45000 }),

  remove: (id: string) => api.delete<void>(`/drawings/${id}`)
}
