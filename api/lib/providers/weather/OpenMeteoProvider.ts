import type { WeatherProvider } from './WeatherProvider'
import type {
  GeocodeResult,
  WeatherDay,
  WeatherHour,
  WeatherLocation,
  WeatherReport,
  WeatherUnits
} from '../../types/domain'

interface OpenMeteoResponse {
  timezone: string
  utc_offset_seconds: number
  current: {
    time: string
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    precipitation: number
    weather_code: number
    is_day: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: number[]
    weather_code: number[]
    is_day: number[]
  }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
    precipitation_sum: number[]
    sunrise: string[]
    sunset: string[]
  }
}

interface GeocodeResponse {
  results?: Array<{
    name: string
    latitude: number
    longitude: number
    country?: string
    admin1?: string
    timezone?: string
  }>
}

/**
 * Open-Meteo. The default, because it needs no API key.
 *
 * That is the whole reason it is the default: a household dashboard that
 * cannot show the weather until somebody registers for an API key is a
 * dashboard whose weather page stays empty.
 */
export class OpenMeteoProvider implements WeatherProvider {
  public readonly id = 'open-meteo'
  public readonly name = 'Open-Meteo'

  private static readonly FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
  private static readonly GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
  private static readonly TIMEOUT_MS = 15000
  private static readonly FORECAST_DAYS = 7

  /** Nothing to configure, which is the point. */
  public isConfigured(): boolean {
    return true
  }

  public async fetch(location: WeatherLocation, units: WeatherUnits): Promise<WeatherReport> {
    const parameters = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      // Resolves the location's own timezone, which is what the daily
      // boundaries and sunrise times have to be expressed in.
      timezone: 'auto',
      temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
      wind_speed_unit: units === 'imperial' ? 'mph' : 'kmh',
      precipitation_unit: units === 'imperial' ? 'inch' : 'mm',
      forecast_days: String(OpenMeteoProvider.FORECAST_DAYS),
      current: [
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'wind_speed_10m',
        'wind_direction_10m',
        'precipitation',
        'weather_code',
        'is_day'
      ].join(','),
      hourly: ['temperature_2m', 'precipitation_probability', 'weather_code', 'is_day'].join(','),
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_probability_max',
        'precipitation_sum',
        'sunrise',
        'sunset'
      ].join(',')
    })

    const response = await OpenMeteoProvider.request<OpenMeteoResponse>(
      `${OpenMeteoProvider.FORECAST_URL}?${parameters.toString()}`
    )

    return OpenMeteoProvider.toReport(response, location, units)
  }

  public async geocode(query: string): Promise<GeocodeResult[]> {
    const trimmed = query.trim()
    if (trimmed.length === 0) return []

    const parameters = new URLSearchParams({
      name: trimmed,
      count: '8',
      language: 'en',
      format: 'json'
    })

    const response = await OpenMeteoProvider.request<GeocodeResponse>(
      `${OpenMeteoProvider.GEOCODE_URL}?${parameters.toString()}`
    )

    // A query with no matches comes back without a `results` key at all,
    // rather than as an empty array.
    return (response.results ?? []).map(result => ({
      name: result.name,
      // Enough to tell Vancouver, BC from Vancouver, Washington.
      region: [result.admin1, result.country].filter(Boolean).join(', '),
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone ?? null
    }))
  }

  /** Exposed for testing against a captured response without a network call. */
  public static toReport(response: OpenMeteoResponse, location: WeatherLocation, units: WeatherUnits): WeatherReport {
    const offsetSeconds = response.utc_offset_seconds

    const hourly: WeatherHour[] = response.hourly.time.map((time, index) => ({
      time: OpenMeteoProvider.toInstant(time, offsetSeconds),
      temperature: response.hourly.temperature_2m[index] ?? 0,
      precipitationProbability: response.hourly.precipitation_probability[index] ?? 0,
      code: response.hourly.weather_code[index] ?? 0,
      isDay: (response.hourly.is_day[index] ?? 1) === 1
    }))

    const daily: WeatherDay[] = response.daily.time.map((date, index) => ({
      // A `date` here is a calendar day in the location's timezone, so it
      // stays a plain string rather than becoming an instant.
      date,
      temperatureMin: response.daily.temperature_2m_min[index] ?? 0,
      temperatureMax: response.daily.temperature_2m_max[index] ?? 0,
      precipitationProbability: response.daily.precipitation_probability_max[index] ?? 0,
      precipitationSum: response.daily.precipitation_sum[index] ?? 0,
      sunrise: OpenMeteoProvider.toInstantOrNull(response.daily.sunrise[index], offsetSeconds),
      sunset: OpenMeteoProvider.toInstantOrNull(response.daily.sunset[index], offsetSeconds),
      code: response.daily.weather_code[index] ?? 0
    }))

    return {
      provider: 'open-meteo',
      location,
      units,
      timezone: response.timezone,
      current: {
        temperature: response.current.temperature_2m,
        feelsLike: response.current.apparent_temperature,
        humidity: response.current.relative_humidity_2m,
        windSpeed: response.current.wind_speed_10m,
        windDirection: response.current.wind_direction_10m,
        precipitation: response.current.precipitation,
        code: response.current.weather_code,
        isDay: response.current.is_day === 1,
        observedAt: OpenMeteoProvider.toInstant(response.current.time, offsetSeconds)
      },
      hourly,
      daily,
      fetchedAt: new Date().toISOString(),
      stale: false
    }
  }

  /**
   * Converts Open-Meteo's naive local time into a real instant.
   *
   * With `timezone=auto` the API returns wall-clock strings with no offset.
   * Handing that to a client unqualified means anything not in the same 
   * timezone reads it wrong, so the provider's own `utc_offset_seconds` is 
   * applied here and everything downstream deals in unambiguous UTC.
   */
  private static toInstant(localTime: string, offsetSeconds: number): string {
    // Parsing with a trailing Z gives the wall-clock reading as if it were
    // UTC; subtracting the offset turns it into the true instant.
    const asIfUtc = Date.parse(`${localTime}${localTime.length === 16 ? ':00' : ''}Z`)
    if (Number.isNaN(asIfUtc)) return new Date().toISOString()

    return new Date(asIfUtc - offsetSeconds * 1000).toISOString()
  }

  private static toInstantOrNull(localTime: string | undefined, offsetSeconds: number): string | null {
    return localTime ? OpenMeteoProvider.toInstant(localTime, offsetSeconds) : null
  }

  private static async request<T>(url: string): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OpenMeteoProvider.TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' }
      })

      if (!response.ok) {
        throw new Error(`Open-Meteo returned ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Open-Meteo did not respond within ${OpenMeteoProvider.TIMEOUT_MS / 1000}s`, {
          cause: error
        })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
