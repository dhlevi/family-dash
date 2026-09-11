import { api } from './client'
import type { CityArt, CityArtOutcome, CityRegionInfo, MapThemeInfo } from './types'

export const cityArtApi = {
  /** The generated artwork the screensaver cycles through, newest first. */
  pool: (limit = 20) => api.get<CityArt[]>('/city-art', { query: { limit } }),

  byId: (id: string) => api.get<CityArt>(`/city-art/${id}`),

  /** The catalogue of art styles, so the Settings page holds no list of its own. */
  themes: () => api.get<MapThemeInfo[]>('/city-art/themes'),

  regions: () => api.get<CityRegionInfo[]>('/city-art/regions'),

  /**
   * Draws one now instead of waiting for the schedule.
   *
   * Generous timeout: this fetches a couple of megabytes of vector tiles,
   * draws them and rasterises the result, on a Raspberry Pi.
   */
  generate: () => api.post<CityArtOutcome>('/city-art/generate', undefined, { timeoutMs: 120000 }),

  remove: (id: string) => api.delete<void>(`/city-art/${id}`)
}
