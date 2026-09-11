import { describe, expect, it } from 'vitest'
import { CITIES, CITY_REGIONS, citiesIn, cityByKey, regionCounts } from '../../../lib/providers/map/cities'

/**
 * The city list is generated data, so these are the checks that a regeneration
 * cannot quietly break: a duplicate key would make two places share their
 * "drawn recently" history, and a coordinate that landed in the wrong
 * hemisphere would show up weeks later as a picture of the wrong continent.
 */
describe('CITIES', () => {
  it('is long enough for repeats to be rare', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(200)
  })

  it('covers every declared region', () => {
    for (const region of CITY_REGIONS) {
      expect(CITIES.filter(city => city.region === region).length, `${region} is empty`).toBeGreaterThan(0)
    }
  })

  it('gives every city a unique key', () => {
    const keys = CITIES.map(city => city.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps every coordinate on the planet', () => {
    for (const city of CITIES) {
      expect(Math.abs(city.latitude), city.name).toBeLessThanOrEqual(90)
      expect(Math.abs(city.longitude), city.name).toBeLessThanOrEqual(180)
      expect(city.latitude === 0 && city.longitude === 0, `${city.name} is at null island`).toBe(false)
    }
  })

  it('asks for a sensible amount of ground', () => {
    for (const city of CITIES) {
      expect(city.spanMetres, city.name).toBeGreaterThanOrEqual(1000)
      expect(city.spanMetres, city.name).toBeLessThanOrEqual(30000)
    }
  })

  it('puts the British Columbia entries in British Columbia', () => {
    // A wrong `countrycodes` filter during generation is the likely way this
    // breaks, and it is invisible until somebody sees a Welsh town captioned
    // as being on Vancouver Island.
    const bc = CITIES.filter(city => city.region === 'british-columbia' || city.region === 'vancouver-island')

    for (const city of bc) {
      expect(city.latitude, city.name).toBeGreaterThan(47)
      expect(city.latitude, city.name).toBeLessThan(61)
      expect(city.longitude, city.name).toBeGreaterThan(-140)
      expect(city.longitude, city.name).toBeLessThan(-113)
    }
  })

  it('puts the Welsh entries in Wales', () => {
    for (const city of CITIES.filter(city => city.region === 'wales')) {
      expect(city.latitude, city.name).toBeGreaterThan(51.2)
      expect(city.latitude, city.name).toBeLessThan(53.6)
      expect(city.longitude, city.name).toBeGreaterThan(-5.7)
      expect(city.longitude, city.name).toBeLessThan(-2.6)
    }
  })
})

describe('citiesIn', () => {
  it('returns everything when nothing is selected', () => {
    expect(citiesIn([])).toHaveLength(CITIES.length)
  })

  it('filters to the chosen regions', () => {
    const welsh = citiesIn(['wales'])

    expect(welsh.length).toBeGreaterThan(0)
    expect(welsh.every(city => city.region === 'wales')).toBe(true)
  })

  it('ignores a region that no longer exists', () => {
    expect(citiesIn(['atlantis'])).toHaveLength(0)
  })
})

describe('cityByKey', () => {
  it('finds a city', () => {
    const first = CITIES[0]!

    expect(cityByKey(first.key)?.name).toBe(first.name)
  })
})

describe('regionCounts', () => {
  it('accounts for every city exactly once', () => {
    expect(regionCounts().reduce((total, entry) => total + entry.count, 0)).toBe(CITIES.length)
  })
})
