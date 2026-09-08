import { AppProperties } from '../../core/AppProperties'
import { toWmoCode } from './OpenWeatherMapCodes'
import type { WeatherProvider } from './WeatherProvider'
import type { WeatherDay, WeatherHour, WeatherLocation, WeatherReport, WeatherUnits } from '../../types/domain'

interface CurrentResponse {
  dt: number
  timezone: number
  main: { temp: number; feels_like: number; humidity: number }
  wind: { speed: number; deg: number }
  rain?: { '1h'?: number }
  snow?: { '1h'?: number }
  weather: Array<{ id: number }>
  sys: { sunrise: number; sunset: number }
}

interface ForecastResponse {
  city: { timezone: number; sunrise: number; sunset: number }
  list: Array<{
    dt: number
    main: { temp: number; temp_min: number; temp_max: number }
    weather: Array<{ id: number }>
    pop?: number
    rain?: { '3h'?: number }
    snow?: { '3h'?: number }
  }>
}

/**
 * OpenWeatherMap, for anyone who already has a key and prefers it.
 *
 * Uses the free 2.5 endpoints, which give current conditions plus a
 * three-hourly forecast — so the "hourly" strip is three-hourly here, and
 * the daily outlook is aggregated from those steps rather than supplied
 * ready-made. Condition ids are translated to WMO codes at the boundary so
 * the UI has a single vocabulary.
 *
 * The live path cannot be exercised without a key, so the parts that can
 * fail quietly — code translation and daily aggregation — are pure functions
 * with tests, and everything else is a thin request wrapper.
 */
export class OpenWeatherMapProvider implements WeatherProvider {
  public readonly id = 'openweathermap'
  public readonly name = 'OpenWeatherMap'

  private static readonly BASE_URL = 'https://api.openweathermap.org/data/2.5'
  private static readonly TIMEOUT_MS = 15000

  public isConfigured(): boolean {
    return OpenWeatherMapProvider.apiKey().length > 0
  }

  private static apiKey(): string {
    return AppProperties.getString('weather.openweathermap.apiKey', '') || process.env.OPENWEATHERMAP_API_KEY || ''
  }

  public async fetch(location: WeatherLocation, units: WeatherUnits): Promise<WeatherReport> {
    const key = OpenWeatherMapProvider.apiKey()
    if (key.length === 0) throw new Error('No OpenWeatherMap API key is configured')

    const shared = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      appid: key,
      units: units === 'imperial' ? 'imperial' : 'metric'
    })

    const [current, forecast] = await Promise.all([
      OpenWeatherMapProvider.request<CurrentResponse>(
        `${OpenWeatherMapProvider.BASE_URL}/weather?${shared.toString()}`
      ),
      OpenWeatherMapProvider.request<ForecastResponse>(
        `${OpenWeatherMapProvider.BASE_URL}/forecast?${shared.toString()}`
      )
    ])

    return OpenWeatherMapProvider.toReport(current, forecast, location, units)
  }

  /** Exposed for testing against captured responses. */
  public static toReport(
    current: CurrentResponse,
    forecast: ForecastResponse,
    location: WeatherLocation,
    units: WeatherUnits
  ): WeatherReport {
    const offsetSeconds = current.timezone ?? 0
    const observedAt = new Date(current.dt * 1000)

    const hourly: WeatherHour[] = forecast.list.map(step => ({
      time: new Date(step.dt * 1000).toISOString(),
      temperature: step.main.temp,
      // `pop` is a 0..1 probability; the rest of the app uses percentages.
      precipitationProbability: Math.round((step.pop ?? 0) * 100),
      code: toWmoCode(step.weather[0]?.id ?? 800),
      isDay: OpenWeatherMapProvider.isDaylight(step.dt, current.sys.sunrise, current.sys.sunset)
    }))

    return {
      provider: 'openweathermap',
      location,
      // The 2.5 endpoints report an offset in seconds, not an IANA zone.
      timezone: OpenWeatherMapProvider.offsetLabel(offsetSeconds),
      units,
      current: {
        temperature: current.main.temp,
        feelsLike: current.main.feels_like,
        humidity: current.main.humidity,
        windSpeed: current.wind.speed,
        windDirection: current.wind.deg,
        precipitation: (current.rain?.['1h'] ?? 0) + (current.snow?.['1h'] ?? 0),
        code: toWmoCode(current.weather[0]?.id ?? 800),
        isDay: OpenWeatherMapProvider.isDaylight(current.dt, current.sys.sunrise, current.sys.sunset),
        observedAt: observedAt.toISOString()
      },
      hourly,
      daily: OpenWeatherMapProvider.aggregateDaily(forecast, offsetSeconds, current.sys),
      fetchedAt: new Date().toISOString(),
      stale: false
    }
  }

  /**
   * Builds a daily outlook from three-hourly steps.
   *
   * Days are bucketed by the *location's* calendar date, not the server's,
   * which is why the offset is applied before reading the date. The
   * representative condition for a day is the one from around the middle of
   * it — a code taken at 3am would describe every day as clear.
   */
  public static aggregateDaily(
    forecast: ForecastResponse,
    offsetSeconds: number,
    sun: { sunrise: number; sunset: number }
  ): WeatherDay[] {
    const buckets = new Map<string, ForecastResponse['list']>()

    for (const step of forecast.list) {
      const localDate = new Date((step.dt + offsetSeconds) * 1000).toISOString().slice(0, 10)
      buckets.set(localDate, [...(buckets.get(localDate) ?? []), step])
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, steps]) => {
        const temperatures = steps.flatMap(step => [step.main.temp_min, step.main.temp_max])

        // The step nearest local midday stands for the day's conditions.
        const middayStep =
          steps.reduce<{ step: ForecastResponse['list'][number]; distance: number } | null>((closest, step) => {
            const localHour = new Date((step.dt + offsetSeconds) * 1000).getUTCHours()
            const distance = Math.abs(localHour - 13)
            return closest === null || distance < closest.distance ? { step, distance } : closest
          }, null)?.step ?? steps[0]

        return {
          date,
          temperatureMin: Math.min(...temperatures),
          temperatureMax: Math.max(...temperatures),
          precipitationProbability: Math.round(Math.max(...steps.map(step => step.pop ?? 0)) * 100),
          precipitationSum:
            Math.round(
              steps.reduce((total, step) => total + (step.rain?.['3h'] ?? 0) + (step.snow?.['3h'] ?? 0), 0) * 10
            ) / 10,
          // The free endpoints give one sunrise and sunset, for today only.
          sunrise: new Date(sun.sunrise * 1000).toISOString(),
          sunset: new Date(sun.sunset * 1000).toISOString(),
          code: toWmoCode(middayStep?.weather[0]?.id ?? 800)
        }
      })
  }

  private static isDaylight(timestamp: number, sunrise: number, sunset: number): boolean {
    // Only today's sunrise and sunset are available, so compare within the
    // day and fall back to a plain daytime window beyond it.
    const secondsOfDay = ((timestamp % 86400) + 86400) % 86400
    const riseOfDay = ((sunrise % 86400) + 86400) % 86400
    const setOfDay = ((sunset % 86400) + 86400) % 86400

    return riseOfDay < setOfDay
      ? secondsOfDay >= riseOfDay && secondsOfDay < setOfDay
      : secondsOfDay >= riseOfDay || secondsOfDay < setOfDay
  }

  /** "UTC+02:00" — the 2.5 endpoints give no IANA zone name. */
  private static offsetLabel(offsetSeconds: number): string {
    const sign = offsetSeconds < 0 ? '-' : '+'
    const total = Math.abs(offsetSeconds)
    const hours = String(Math.floor(total / 3600)).padStart(2, '0')
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')

    return `UTC${sign}${hours}:${minutes}`
  }

  private static async request<T>(url: string): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OpenWeatherMapProvider.TIMEOUT_MS)

    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })

      if (response.status === 401) {
        throw new Error('OpenWeatherMap rejected the API key')
      }
      if (!response.ok) {
        throw new Error(`OpenWeatherMap returned ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenWeatherMap did not respond within ${OpenWeatherMapProvider.TIMEOUT_MS / 1000}s`, {
          cause: error
        })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
