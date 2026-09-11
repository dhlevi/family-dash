import { PostgresDatabase } from '../db/PostgresDatabase'
import type { WeatherLocation, WeatherReport, WeatherUnits } from '../types/domain'

interface WeatherCacheRow {
  payload: WeatherReport
  fetched_at: Date
}

/**
 * The last good forecast, per provider and location.
 *
 * The whole reason this table exists is that a wall display should keep
 * showing yesterday's forecast, clearly labelled as stale, rather than an
 * error, when the Pi's wifi drops or the provider has a bad afternoon.
 *
 * `location` is the jsonb key, and includes the units: a cached Celsius
 * forecast is not an answer to a request for Fahrenheit.
 */
export class WeatherCacheRepository {
  /**
   * The cache key. Coordinates are rounded because a household's location
   * does not move, and full float precision would miss the cache on any
   * trivial difference in how it was entered.
   */
  private static key(location: WeatherLocation, units: WeatherUnits): string {
    return JSON.stringify({
      latitude: Math.round(location.latitude * 1000) / 1000,
      longitude: Math.round(location.longitude * 1000) / 1000,
      units
    })
  }

  public async get(
    provider: string,
    location: WeatherLocation,
    units: WeatherUnits
  ): Promise<{ report: WeatherReport; fetchedAt: Date } | null> {
    const row = await PostgresDatabase.one<WeatherCacheRow>(
      'SELECT payload, fetched_at FROM weather_cache WHERE provider = $1 AND location = $2::jsonb',
      [provider, WeatherCacheRepository.key(location, units)]
    )

    return row ? { report: row.payload, fetchedAt: row.fetched_at } : null
  }

  public async put(
    provider: string,
    location: WeatherLocation,
    units: WeatherUnits,
    report: WeatherReport
  ): Promise<void> {
    await PostgresDatabase.execute(
      `INSERT INTO weather_cache (provider, location, payload, fetched_at)
       VALUES ($1, $2::jsonb, $3::jsonb, now())
       ON CONFLICT (provider, location)
       DO UPDATE SET payload = excluded.payload, fetched_at = now()`,
      [provider, WeatherCacheRepository.key(location, units), JSON.stringify(report)]
    )
  }

  /**
   * Drop cached forecasts for locations nobody is asking about any more.
   *
   * Changing the configured location, or searching for somewhere while
   * setting it up, would otherwise leave rows behind for good.
   */
  public async pruneOtherThan(provider: string, location: WeatherLocation, units: WeatherUnits): Promise<number> {
    return PostgresDatabase.execute('DELETE FROM weather_cache WHERE NOT (provider = $1 AND location = $2::jsonb)', [
      provider,
      WeatherCacheRepository.key(location, units)
    ])
  }
}
