import type { Theme } from '@/api/types'

/**
 * Which theme the automatic setting should be showing.
 *
 * Separated from the store so the decision is testable on its own — it is
 * the sort of thing that is quietly wrong for half the year otherwise.
 */
export interface SunTimes {
  sunrise: Date
  sunset: Date
}

/**
 * Fixed hours used when there are no solar times to work from — the weather
 * provider is unreachable on a first run, or the location is far enough
 * north that the sun does not set at all.
 */
export const FALLBACK_LIGHT_FROM_HOUR = 7
export const FALLBACK_LIGHT_UNTIL_HOUR = 19

/**
 * Resolves the automatic theme.
 *
 * Light between sunrise and sunset, pulled in from both ends by `offset`
 * minutes: the point of the offset is that daybreak is an unkind moment for
 * a screen in a dim kitchen to turn white, and dusk arrives before the sun
 * has technically gone.
 *
 * A large offset on a short winter day can invert the window entirely, which
 * would otherwise flip the screen to light at dusk and dark at dawn. That
 * case resolves to dark for the whole day, which is what somebody asking for
 * a wide offset means.
 */
export function resolveAutoTheme(now: Date, sun: SunTimes | null, offsetMinutes = 0): Theme {
  if (!sun) {
    const hour = now.getHours()
    return hour >= FALLBACK_LIGHT_FROM_HOUR && hour < FALLBACK_LIGHT_UNTIL_HOUR ? 'light' : 'dark'
  }

  const offset = offsetMinutes * 60_000
  const lightFrom = sun.sunrise.getTime() + offset
  const lightUntil = sun.sunset.getTime() - offset

  if (lightUntil <= lightFrom) return 'dark'

  const at = now.getTime()
  return at >= lightFrom && at < lightUntil ? 'light' : 'dark'
}

/** Parses the ISO times a weather report carries, or null if it has none. */
export function sunTimesFrom(sunrise: string | null, sunset: string | null): SunTimes | null {
  if (!sunrise || !sunset) return null

  const parsedSunrise = new Date(sunrise)
  const parsedSunset = new Date(sunset)

  if (Number.isNaN(parsedSunrise.getTime()) || Number.isNaN(parsedSunset.getTime())) return null
  // A provider that reports sunset before sunrise has given us something we
  // cannot reason about; the fixed fallback is safer than trusting it.
  if (parsedSunset <= parsedSunrise) return null

  return { sunrise: parsedSunrise, sunset: parsedSunset }
}
