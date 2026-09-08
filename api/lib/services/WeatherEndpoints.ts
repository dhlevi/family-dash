import { ApiError } from '../core/model/ApiError'
import { WeatherProviderRegistry } from '../providers/weather'
import { WeatherService } from './WeatherService'
import type { GeocodeResult, WeatherReport } from '../types/domain'

const service = new WeatherService()

export interface WeatherProviderInfo {
  id: string
  name: string
  configured: boolean
  canGeocode: boolean
}

export class WeatherEndpoints {
  public async report(refresh?: boolean): Promise<WeatherReport> {
    try {
      return await service.report(refresh === true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Nothing cached and the provider is unreachable: a 503 says "try
      // again" rather than implying the request was wrong.
      throw ApiError.unavailable(`Could not get a forecast: ${message}`)
    }
  }

  /**
   * Search for a place by name.
   *
   * Proxied through the API rather than called from the browser so the front
   * end talks to one origin, and so the provider seam covers geocoding too.
   */
  public async search(query?: string): Promise<GeocodeResult[]> {
    const trimmed = (query ?? '').trim()
    if (trimmed.length < 2) {
      throw ApiError.badRequest('Type at least two characters to search for a place')
    }

    const provider = WeatherProviderRegistry.geocoder()
    if (!provider?.geocode) {
      throw ApiError.unavailable('No configured weather provider can look up place names')
    }

    try {
      return await provider.geocode(trimmed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw ApiError.badGateway(`Place search failed: ${message}`)
    }
  }

  /** Which providers exist and which are usable, for the Settings page. */
  public async providers(): Promise<WeatherProviderInfo[]> {
    return WeatherProviderRegistry.all().map(provider => ({
      id: provider.id,
      name: provider.name,
      configured: provider.isConfigured(),
      canGeocode: typeof provider.geocode === 'function'
    }))
  }
}
