import { api } from './client'
import type { Photo, PhotoAlbum, PhotoScanOutcome, PhotoUploadOutcome } from './types'

export const photosApi = {
  /** Newest first. Omit `album` for everything, or pass '' for loose files. */
  list: (filter: { album?: string; favouritesOnly?: boolean; limit?: number; offset?: number } = {}) =>
    api.get<Photo[]>('/photos', { query: { ...filter } }),

  albums: () => api.get<PhotoAlbum[]>('/photos/albums'),

  byId: (id: string) => api.get<Photo>(`/photos/${id}`),

  count: (album?: string) => api.get<{ total: number }>('/photos/count', { query: { album } }),

  /**
   * Uploads pictures into an album.
   *
   * Generous timeout: this is a phone on house wifi sending a dozen photos,
   * and each one is decoded and thumbnailed on a Raspberry Pi before the
   * response comes back.
   */
  upload: (files: File[], album?: string) => {
    const form = new FormData()
    if (album) form.set('album', album)
    for (const file of files) form.append('files', file)

    return api.post<PhotoUploadOutcome>('/photos', form, { timeoutMs: 300000 })
  },

  favourite: (id: string, favourite: boolean) => api.patch<Photo>(`/photos/${id}`, { favourite }),

  /** Deletes the file from the media volume as well as the index. */
  remove: (id: string) => api.delete<void>(`/photos/${id}`),

  /** Reconciles the index with the media volume. Walks the whole library. */
  scan: () => api.post<PhotoScanOutcome>('/photos/scan', undefined, { timeoutMs: 300000 })
}
