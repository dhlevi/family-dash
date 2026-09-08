import { describe, expect, it } from 'vitest'
import {
  compassPoint,
  conditionFor,
  describeCode,
  formatTemperature,
  isWet,
  precipitationUnit,
  temperatureUnit,
  windUnit
} from './weather'

/**
 * This is the only place the app decides what a sky looks like, for both
 * providers. The important property is the fallback: an unknown code must
 * never render as sunshine.
 */
describe('conditionFor', () => {
  it('maps the clear and cloudy codes', () => {
    expect(conditionFor(0).kind).toBe('clear')
    expect(conditionFor(1).kind).toBe('clear')
    expect(conditionFor(2).kind).toBe('partly-cloudy')
    expect(conditionFor(3).kind).toBe('cloudy')
  })

  it('maps precipitation to its own kinds', () => {
    expect(conditionFor(53).kind).toBe('drizzle')
    expect(conditionFor(63).kind).toBe('rain')
    expect(conditionFor(81).kind).toBe('showers')
    expect(conditionFor(73).kind).toBe('snow')
    expect(conditionFor(66).kind).toBe('freezing')
    expect(conditionFor(95).kind).toBe('thunderstorm')
    expect(conditionFor(45).kind).toBe('fog')
  })

  it('treats snow showers as snow, not showers', () => {
    // 85/86 are snow showers; drawing rain for them would be wrong.
    expect(conditionFor(85).kind).toBe('snow')
    expect(conditionFor(86).kind).toBe('snow')
  })

  it('falls back to cloudy for an unknown code, never to clear', () => {
    // Drawing a sun for weather we cannot identify is the one wrong answer
    // that might send somebody out without a coat.
    expect(conditionFor(4).kind).toBe('cloudy')
    expect(conditionFor(-1).kind).toBe('cloudy')
    expect(conditionFor(12345).kind).toBe('cloudy')
  })

  it('has a label for every code it claims to know', () => {
    for (const code of [
      0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99
    ]) {
      expect(describeCode(code).length, `code ${code}`).toBeGreaterThan(2)
    }
  })
})

describe('isWet', () => {
  it('is true for anything that falls out of the sky', () => {
    for (const code of [51, 63, 81, 73, 66, 95, 86]) {
      expect(isWet(code), `code ${code}`).toBe(true)
    }
  })

  it('is false for clear, cloudy and fog', () => {
    // Fog is unpleasant but it does not need an umbrella.
    for (const code of [0, 1, 2, 3, 45]) {
      expect(isWet(code), `code ${code}`).toBe(false)
    }
  })
})

describe('units', () => {
  it('switches with the unit system', () => {
    expect(temperatureUnit('metric')).toBe('°C')
    expect(temperatureUnit('imperial')).toBe('°F')
    expect(windUnit('metric')).toBe('km/h')
    expect(windUnit('imperial')).toBe('mph')
    expect(precipitationUnit('metric')).toBe('mm')
    expect(precipitationUnit('imperial')).toBe('in')
  })

  it('rounds temperatures for a wall display', () => {
    expect(formatTemperature(16.4)).toBe('16°')
    expect(formatTemperature(16.6)).toBe('17°')
    expect(formatTemperature(-0.4)).toBe('0°')
  })
})

describe('compassPoint', () => {
  it('names the cardinal points', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(90)).toBe('E')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(270)).toBe('W')
  })

  it('names the intermediate points', () => {
    expect(compassPoint(45)).toBe('NE')
    expect(compassPoint(225)).toBe('SW')
    expect(compassPoint(247.5)).toBe('WSW')
  })

  it('wraps rather than falling off the end of the compass', () => {
    // 350 rounds to index 16, which must come back round to N.
    expect(compassPoint(350)).toBe('N')
    expect(compassPoint(360)).toBe('N')
    expect(compassPoint(720)).toBe('N')
  })

  it('handles a negative bearing', () => {
    expect(compassPoint(-90)).toBe('W')
  })
})
