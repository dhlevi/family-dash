/**
 * Translating OpenWeatherMap condition ids into WMO weather codes.
 *
 * Open-Meteo speaks WMO, which the UI already maps to icons and labels.
 * Rather than teach the front end a second vocabulary — and keep two icon
 * mappings in step forever — OpenWeatherMap's ids are normalised here, at
 * the edge, so everything downstream sees one kind of code.
 *
 * The mapping is approximate by nature: the two scales do not describe
 * exactly the same buckets. It errs towards the nearer WMO code rather than
 * inventing precision, since the result drives a picture of a cloud.
 */

/** WMO codes the UI knows how to draw. */
export const WMO = {
  clear: 0,
  mainlyClear: 1,
  partlyCloudy: 2,
  overcast: 3,
  fog: 45,
  drizzleLight: 51,
  drizzleModerate: 53,
  drizzleDense: 55,
  freezingDrizzle: 56,
  rainSlight: 61,
  rainModerate: 63,
  rainHeavy: 65,
  freezingRain: 66,
  snowSlight: 71,
  snowModerate: 73,
  snowHeavy: 75,
  rainShowersSlight: 80,
  rainShowersModerate: 81,
  rainShowersViolent: 82,
  snowShowersSlight: 85,
  snowShowersHeavy: 86,
  thunderstorm: 95,
  thunderstormHail: 96
} as const

/** Ids that do not follow their group's pattern. */
const EXACT: Record<number, number> = {
  // Thunderstorms with hail.
  202: WMO.thunderstormHail,
  212: WMO.thunderstormHail,
  221: WMO.thunderstormHail,
  232: WMO.thunderstormHail,

  // Freezing precipitation.
  511: WMO.freezingRain,
  611: WMO.freezingRain,
  612: WMO.freezingDrizzle,
  613: WMO.freezingRain,
  615: WMO.snowSlight,
  616: WMO.snowModerate,

  // Snow showers.
  620: WMO.snowShowersSlight,
  621: WMO.snowShowersSlight,
  622: WMO.snowShowersHeavy,

  // Snowfall, by intensity.
  600: WMO.snowSlight,
  601: WMO.snowModerate,
  602: WMO.snowHeavy,

  // Rain showers.
  520: WMO.rainShowersSlight,
  521: WMO.rainShowersModerate,
  522: WMO.rainShowersViolent,
  531: WMO.rainShowersViolent,

  // Cloud cover, which OpenWeatherMap splits more finely than WMO.
  800: WMO.clear,
  801: WMO.mainlyClear,
  802: WMO.partlyCloudy,
  803: WMO.overcast,
  804: WMO.overcast,

  // Squalls and tornadoes are violent enough to warrant the storm icon.
  771: WMO.thunderstorm,
  781: WMO.thunderstorm
}

export function toWmoCode(openWeatherMapId: number): number {
  const exact = EXACT[openWeatherMapId]
  if (exact !== undefined) return exact

  // Groups, by leading digit.
  if (openWeatherMapId >= 200 && openWeatherMapId < 300) return WMO.thunderstorm

  if (openWeatherMapId >= 300 && openWeatherMapId < 400) {
    // Keyed on the last digit: 300/310 are light, 301/311/313/321 moderate
    // (321 is "shower drizzle"), and 302/312/314 heavy.
    const intensity = openWeatherMapId % 10
    if (intensity === 0) return WMO.drizzleLight
    if (intensity === 1 || intensity === 3) return WMO.drizzleModerate
    return WMO.drizzleDense
  }

  if (openWeatherMapId >= 500 && openWeatherMapId < 600) {
    if (openWeatherMapId === 500) return WMO.rainSlight
    if (openWeatherMapId === 501) return WMO.rainModerate
    return WMO.rainHeavy
  }

  if (openWeatherMapId >= 600 && openWeatherMapId < 700) return WMO.snowModerate

  // 7xx is the "atmosphere" group: mist, haze, dust, ash.
  if (openWeatherMapId >= 700 && openWeatherMapId < 800) return WMO.fog

  // An id outside every documented group; overcast is the least misleading
  // thing to draw for an unknown sky.
  return WMO.overcast
}
