import type { WeatherUnitSystem } from '@/api/types'

/**
 * Interpreting WMO weather codes.
 *
 * Both providers are normalised to this scale by the API, so this is the
 * only place the app decides what a sky looks like. The buckets are coarser
 * than WMO itself: a household glancing at a wall does not need "moderate
 * drizzle" distinguished from "light drizzle", it needs to know whether to
 * take a coat.
 */
export type WeatherKind =
  'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'freezing' | 'snow' | 'showers' | 'thunderstorm'

interface Condition {
  kind: WeatherKind
  label: string
}

/**
 * WMO code to condition. Codes are grouped exactly as the standard defines
 * them, which is why this is a lookup rather than arithmetic.
 */
const CONDITIONS: Record<number, Condition> = {
  0: { kind: 'clear', label: 'Clear' },
  1: { kind: 'clear', label: 'Mainly clear' },
  2: { kind: 'partly-cloudy', label: 'Partly cloudy' },
  3: { kind: 'cloudy', label: 'Overcast' },

  45: { kind: 'fog', label: 'Fog' },
  48: { kind: 'fog', label: 'Freezing fog' },

  51: { kind: 'drizzle', label: 'Light drizzle' },
  53: { kind: 'drizzle', label: 'Drizzle' },
  55: { kind: 'drizzle', label: 'Heavy drizzle' },
  56: { kind: 'freezing', label: 'Freezing drizzle' },
  57: { kind: 'freezing', label: 'Freezing drizzle' },

  61: { kind: 'rain', label: 'Light rain' },
  63: { kind: 'rain', label: 'Rain' },
  65: { kind: 'rain', label: 'Heavy rain' },
  66: { kind: 'freezing', label: 'Freezing rain' },
  67: { kind: 'freezing', label: 'Freezing rain' },

  71: { kind: 'snow', label: 'Light snow' },
  73: { kind: 'snow', label: 'Snow' },
  75: { kind: 'snow', label: 'Heavy snow' },
  77: { kind: 'snow', label: 'Snow grains' },

  80: { kind: 'showers', label: 'Light showers' },
  81: { kind: 'showers', label: 'Showers' },
  82: { kind: 'showers', label: 'Heavy showers' },
  85: { kind: 'snow', label: 'Snow showers' },
  86: { kind: 'snow', label: 'Heavy snow showers' },

  95: { kind: 'thunderstorm', label: 'Thunderstorm' },
  96: { kind: 'thunderstorm', label: 'Thunderstorm with hail' },
  99: { kind: 'thunderstorm', label: 'Thunderstorm with hail' }
}

/**
 * The condition for a code.
 *
 * An unrecognised code falls back to cloudy rather than clear: drawing a sun
 * for weather we cannot identify is the one wrong answer that might send
 * somebody out without a coat.
 */
export function conditionFor(code: number): Condition {
  return CONDITIONS[code] ?? { kind: 'cloudy', label: 'Unsettled' }
}

export function describeCode(code: number): string {
  return conditionFor(code).label
}

/** Whether a condition means "you will get wet". Drives the rain emphasis. */
export function isWet(code: number): boolean {
  return ['drizzle', 'rain', 'showers', 'thunderstorm', 'snow', 'freezing'].includes(conditionFor(code).kind)
}

// --- units ------------------------------------------------------------------

export function temperatureUnit(units: WeatherUnitSystem): string {
  return units === 'imperial' ? '°F' : '°C'
}

export function windUnit(units: WeatherUnitSystem): string {
  return units === 'imperial' ? 'mph' : 'km/h'
}

export function precipitationUnit(units: WeatherUnitSystem): string {
  return units === 'imperial' ? 'in' : 'mm'
}

/** Rounded for display. A wall display does not need a decimal place. */
export function formatTemperature(value: number): string {
  return `${Math.round(value)}°`
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/**
 * A wind bearing as a compass point.
 *
 * "WSW" is readable across a kitchen in a way that "245°" is not. Each of the
 * sixteen points covers 22.5°, and the rounding wraps so 350° reads as N.
 */
export function compassPoint(degrees: number): string {
  const normalised = ((degrees % 360) + 360) % 360
  return COMPASS[Math.round(normalised / 22.5) % 16] ?? 'N'
}
