import { describe, expect, it } from 'vitest'
import { OpenMeteoProvider } from '../../lib/providers/weather/OpenMeteoProvider'
import type { WeatherLocation } from '../../lib/types/domain'

/**
 * The thing worth guarding here is the timezone conversion.
 *
 * With `timezone=auto`, Open-Meteo returns wall-clock strings with no offset
 * — "2026-09-07T20:00" means 8pm *at the location*. Passing that on
 * unqualified means every consumer has to guess, and guessing wrong shifts
 * the whole forecast by hours without anything looking broken.
 */
const location: WeatherLocation = { latitude: 49.2827, longitude: -123.1207, name: 'Vancouver' }

/** Shaped like a real response, trimmed to three hours and two days. */
const response = {
  timezone: 'America/Vancouver',
  // Vancouver in September is UTC-7.
  utc_offset_seconds: -25200,
  current: {
    time: '2026-09-07T20:00',
    temperature_2m: 16,
    apparent_temperature: 16.3,
    relative_humidity_2m: 83,
    wind_speed_10m: 4.5,
    wind_direction_10m: 61,
    precipitation: 0,
    weather_code: 2,
    is_day: 0
  },
  hourly: {
    time: ['2026-09-07T00:00', '2026-09-07T01:00', '2026-09-07T02:00'],
    temperature_2m: [13.7, 13.2, 12.9],
    precipitation_probability: [0, 3, 5],
    weather_code: [0, 1, 2],
    is_day: [0, 0, 0]
  },
  daily: {
    time: ['2026-09-07', '2026-09-08'],
    weather_code: [3, 61],
    temperature_2m_max: [17.6, 18.1],
    temperature_2m_min: [11.9, 12.4],
    precipitation_probability_max: [7, 65],
    precipitation_sum: [0, 4.2],
    sunrise: ['2026-09-07T06:37', '2026-09-08T06:39'],
    sunset: ['2026-09-07T19:42', '2026-09-08T19:40']
  }
}

const report = OpenMeteoProvider.toReport(response, location, 'metric')

describe('OpenMeteoProvider.toReport', () => {
  it('converts the naive local observation time into a true instant', () => {
    // 20:00 in UTC-7 is 03:00 UTC the next day.
    expect(report.current.observedAt).toBe('2026-09-08T03:00:00.000Z')
  })

  it('converts hourly times with the same offset', () => {
    // Midnight local on the 7th is 07:00 UTC on the 7th.
    expect(report.hourly[0]?.time).toBe('2026-09-07T07:00:00.000Z')
    expect(report.hourly[1]?.time).toBe('2026-09-07T08:00:00.000Z')
  })

  it('converts sunrise and sunset', () => {
    expect(report.daily[0]?.sunrise).toBe('2026-09-07T13:37:00.000Z')
    expect(report.daily[0]?.sunset).toBe('2026-09-08T02:42:00.000Z')
  })

  it('leaves the daily date as a plain calendar day', () => {
    // A forecast day is "the 7th there", not an instant — converting it
    // would land it on the 6th for anyone west of the location.
    expect(report.daily[0]?.date).toBe('2026-09-07')
    expect(report.daily[1]?.date).toBe('2026-09-08')
  })

  it('keeps the location timezone so the UI can label it', () => {
    expect(report.timezone).toBe('America/Vancouver')
  })

  it('maps the current conditions', () => {
    expect(report.current).toMatchObject({
      temperature: 16,
      feelsLike: 16.3,
      humidity: 83,
      windSpeed: 4.5,
      windDirection: 61,
      precipitation: 0,
      code: 2,
      isDay: false
    })
  })

  it('maps daily values, including a wet day', () => {
    expect(report.daily[1]).toMatchObject({
      temperatureMin: 12.4,
      temperatureMax: 18.1,
      precipitationProbability: 65,
      precipitationSum: 4.2,
      code: 61
    })
  })

  it('reports its own id, the requested units and a fetch time', () => {
    expect(report.provider).toBe('open-meteo')
    expect(report.units).toBe('metric')
    expect(report.stale).toBe(false)
    expect(Number.isNaN(Date.parse(report.fetchedAt))).toBe(false)
  })

  it('handles a positive offset as well as a negative one', () => {
    const sydney = OpenMeteoProvider.toReport(
      { ...response, timezone: 'Australia/Sydney', utc_offset_seconds: 36000 },
      { latitude: -33.87, longitude: 151.21, name: 'Sydney' },
      'metric'
    )

    // 20:00 at UTC+10 is 10:00 UTC the same day.
    expect(sydney.current.observedAt).toBe('2026-09-07T10:00:00.000Z')
  })

  it('handles a zero offset', () => {
    const london = OpenMeteoProvider.toReport(
      { ...response, timezone: 'UTC', utc_offset_seconds: 0 },
      { latitude: 51.5, longitude: 0, name: 'London' },
      'metric'
    )

    expect(london.current.observedAt).toBe('2026-09-07T20:00:00.000Z')
  })

  it('tolerates a missing value in a parallel array rather than throwing', () => {
    // The API returns nulls for hours it has no data for.
    const gappy = OpenMeteoProvider.toReport(
      {
        ...response,
        hourly: { ...response.hourly, temperature_2m: [13.7], precipitation_probability: [] }
      },
      location,
      'metric'
    )

    expect(gappy.hourly).toHaveLength(3)
    expect(gappy.hourly[1]?.temperature).toBe(0)
    expect(gappy.hourly[1]?.precipitationProbability).toBe(0)
  })
})
