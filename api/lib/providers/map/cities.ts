import { CITY_LIST } from './cityList'

/**
 * The places the screensaver can draw.
 *
 * A fixed, curated list rather than a geocoder call. Three reasons, in order
 * of how much they matter: a wall display that has to survive a week of bad
 * wifi should not depend on a lookup service at all; Nominatim's usage policy
 * is written for exactly this kind of automated querying and asks people not
 * to do it; and a list chosen by hand is simply better, because "somewhere
 * with interesting streets" is an aesthetic judgement and not something a
 * population figure predicts.
 *
 * Coordinates in `cityList.ts` were resolved once, offline, and committed. See
 * `scripts/build-city-list.mjs` to add your own.
 */

export const CITY_REGIONS = ['world', 'british-columbia', 'vancouver-island', 'wales'] as const

export type CityRegion = (typeof CITY_REGIONS)[number]

export interface City {
  /** Stable id, used to remember where the generator has been lately. */
  key: string
  name: string
  country: string
  region: CityRegion
  latitude: number
  longitude: number
  /**
   * How much ground the picture covers, measured across the frame in metres.
   *
   * Set per city rather than derived from a zoom, because the right amount of
   * ground is a property of the place: thirteen kilometres across Vancouver is
   * a city, thirteen across Tofino is mostly ocean.
   */
  spanMetres: number
}

export const CITIES: City[] = CITY_LIST

/** Human labels for the Settings page, so the UI holds no list of its own. */
export const REGION_LABELS: Record<CityRegion, string> = {
  world: 'Around the world',
  'british-columbia': 'British Columbia',
  'vancouver-island': 'Vancouver Island',
  wales: 'Wales'
}

export function cityByKey(key: string): City | undefined {
  return CITIES.find(city => city.key === key)
}

export function citiesIn(regions: readonly string[]): City[] {
  if (regions.length === 0) return CITIES
  const wanted = new Set(regions)

  return CITIES.filter(city => wanted.has(city.region))
}

/** How many cities each region contributes, for the Settings page. */
export function regionCounts(): Array<{ region: CityRegion; label: string; count: number }> {
  return CITY_REGIONS.map(region => ({
    region,
    label: REGION_LABELS[region],
    count: CITIES.filter(city => city.region === region).length
  }))
}
