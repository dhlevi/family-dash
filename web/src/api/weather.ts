import { api } from './client'
import type { GeocodeResult, WeatherProviderInfo, WeatherReport } from './types'

export const weatherApi = {
  /** The cached forecast. Fast, and works when the provider is unreachable. */
  report: () => api.get<WeatherReport>('/weather'),

  /** Fetch from the provider now. Slower, and may still come back stale. */
  refresh: () => api.post<WeatherReport>('/weather/refresh', undefined, { timeoutMs: 30000 }),

  /** Search for a place, so the location can be set without typing coordinates. */
  search: (query: string) => api.get<GeocodeResult[]>('/weather/search', { query: { q: query } }),

  providers: () => api.get<WeatherProviderInfo[]>('/weather/providers')
}
