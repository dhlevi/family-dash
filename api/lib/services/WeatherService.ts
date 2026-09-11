import { AppProperties } from '../core/AppProperties'
import { WeatherProviderRegistry } from '../providers/weather'
import { SettingRepository } from '../repositories/SettingRepository'
import { WeatherCacheRepository } from '../repositories/WeatherCacheRepository'
import type { WeatherLocation, WeatherReport, WeatherUnits } from '../types/domain'

const cache = new WeatherCacheRepository()
const settings = new SettingRepository()

/**
 * Fetching, caching and serving forecasts.
 *
 * Reads always come from the cache; only the scheduled task and an explicit
 * refresh talk to a provider. That keeps the weather page instant, keeps the
 * Pi from hammering a free API every time somebody walks past the screen,
 * and means a network outage degrades to "here is the last forecast, an hour
 * old" instead of an error.
 */
export class WeatherService {
  /** Beyond this, a cached forecast is labelled stale in the response. */
  private static readonly STALE_AFTER_MS = 90 * 60 * 1000

  /** Where the forecast is for, and in what units. Settings over config defaults. */
  public async configuration(): Promise<{ location: WeatherLocation; units: WeatherUnits; provider: string }> {
    const stored = await settings.all()

    const latitude = WeatherService.asNumber(
      stored['weather.latitude'],
      AppProperties.getNumber('weather.latitude', 49.2827)
    )
    const longitude = WeatherService.asNumber(
      stored['weather.longitude'],
      AppProperties.getNumber('weather.longitude', -123.1207)
    )
    const name =
      typeof stored['weather.locationName'] === 'string' && stored['weather.locationName'].trim().length > 0
        ? (stored['weather.locationName'] as string)
        : AppProperties.getString('weather.location.name', 'Home')

    const units: WeatherUnits = stored['weather.units'] === 'imperial' ? 'imperial' : 'metric'

    return {
      location: { latitude, longitude, name },
      units,
      provider: AppProperties.getString('weather.provider', 'open-meteo')
    }
  }

  /**
   * The current forecast.
   *
   * Serves the cache when it is fresh. When it is not, tries the provider and
   * falls back to whatever is cached,marked stale,rather than failing.
   */
  public async report(force = false): Promise<WeatherReport> {
    const { location, units, provider: preferred } = await this.configuration()
    const provider = WeatherProviderRegistry.resolve(preferred)

    if (!provider) throw new Error('No weather provider is available')

    const cached = await cache.get(provider.id, location, units)
    const age = cached ? Date.now() - cached.fetchedAt.getTime() : Infinity

    if (!force && cached && age < WeatherService.STALE_AFTER_MS) {
      return { ...cached.report, stale: false, fetchedAt: cached.fetchedAt.toISOString() }
    }

    try {
      const fresh = await provider.fetch(location, units)
      await cache.put(provider.id, location, units, fresh)
      return fresh
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (cached) {
        // The forecast on the wall is old, and the UI will say so, which is
        // considerably more useful than an error where the weather was.
        console.warn(
          `Weather refresh failed (${message}); serving a cached forecast from ${cached.fetchedAt.toISOString()}`
        )
        return { ...cached.report, stale: true, fetchedAt: cached.fetchedAt.toISOString() }
      }

      throw error instanceof Error ? error : new Error(message)
    }
  }

  /**
   * Called by the scheduled task; refreshes and tidies unused locations.
   *
   * Throws when the provider could not be reached, even though a stale
   * forecast was served to callers. The task's recorded error is the only
   * place a persistently unreachable provider becomes visible. Without
   * this, Settings would report "last run ok" while the forecast quietly
   * aged on the wall. TaskManager records the failure and keeps the
   * schedule running, which is the behaviour wanted here.
   */
  public async refresh(): Promise<{ provider: string; location: string }> {
    const report = await this.report(true)
    const { location, units } = await this.configuration()

    await cache.pruneOtherThan(report.provider, location, units)

    if (report.stale) {
      throw new Error(
        `Could not reach ${report.provider}; the dashboard is showing a cached forecast from ` + `${report.fetchedAt}`
      )
    }

    return { provider: report.provider, location: report.location.name }
  }

  private static asNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
}
