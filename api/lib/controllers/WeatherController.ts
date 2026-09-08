import { Controller } from '../core/Controller'
import { Get, NoCache, Post, Query, Response, Route, SuccessResponse } from '../core/Decorators'
import { WeatherEndpoints, type WeatherProviderInfo } from '../services/WeatherEndpoints'
import type { GeocodeResult, WeatherReport } from '../types/domain'

const endpoints = new WeatherEndpoints()

/**
 * The forecast.
 *
 * Reads come from the local cache that the background task keeps filled, so
 * the page is instant and a network outage shows the last known forecast
 * marked stale rather than an error.
 */
@Route('api/weather')
export class WeatherController extends Controller {
  public constructor() {
    super()
  }

  /** The current forecast for the configured location. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @Response(503, 'No forecast available and the provider is unreachable')
  @NoCache()
  public async getWeather(): Promise<WeatherReport> {
    return endpoints.report(false)
  }

  /** Fetch from the provider now, rather than waiting for the schedule. */
  @Post('refresh')
  @SuccessResponse(200, 'OK')
  @Response(503, 'Provider unreachable')
  @NoCache()
  public async postRefresh(): Promise<WeatherReport> {
    return endpoints.report(true)
  }

  /** Search for a place by name, to set the location without typing coordinates. */
  @Get('search')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Query too short')
  @Response(503, 'No provider can look up place names')
  @NoCache()
  public async getSearch(@Query('q') query?: string): Promise<GeocodeResult[]> {
    return endpoints.search(query)
  }

  @Get('providers')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getProviders(): Promise<WeatherProviderInfo[]> {
    return endpoints.providers()
  }
}
