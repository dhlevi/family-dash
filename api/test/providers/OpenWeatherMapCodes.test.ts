import { describe, expect, it } from 'vitest'
import { toWmoCode, WMO } from '../../lib/providers/weather/OpenWeatherMapCodes'

/**
 * OpenWeatherMap's condition ids are normalised into WMO codes at the edge so
 * the UI has one vocabulary and one icon mapping. Getting this wrong shows
 * the wrong picture of the sky, which is the only thing most people look at.
 */
describe('toWmoCode', () => {
  it('maps clear and cloudy', () => {
    expect(toWmoCode(800)).toBe(WMO.clear)
    expect(toWmoCode(801)).toBe(WMO.mainlyClear)
    expect(toWmoCode(802)).toBe(WMO.partlyCloudy)
    expect(toWmoCode(803)).toBe(WMO.overcast)
    expect(toWmoCode(804)).toBe(WMO.overcast)
  })

  it('maps rain by intensity', () => {
    expect(toWmoCode(500)).toBe(WMO.rainSlight)
    expect(toWmoCode(501)).toBe(WMO.rainModerate)
    expect(toWmoCode(502)).toBe(WMO.rainHeavy)
    expect(toWmoCode(503)).toBe(WMO.rainHeavy)
  })

  it('maps rain showers separately from steady rain', () => {
    expect(toWmoCode(520)).toBe(WMO.rainShowersSlight)
    expect(toWmoCode(521)).toBe(WMO.rainShowersModerate)
    expect(toWmoCode(522)).toBe(WMO.rainShowersViolent)
  })

  it('maps drizzle by intensity', () => {
    expect(toWmoCode(300)).toBe(WMO.drizzleLight)
    expect(toWmoCode(301)).toBe(WMO.drizzleModerate)
    expect(toWmoCode(302)).toBe(WMO.drizzleDense)
    expect(toWmoCode(310)).toBe(WMO.drizzleLight)
    expect(toWmoCode(312)).toBe(WMO.drizzleDense)
    // 321 is "shower drizzle" — a shower, not a downpour.
    expect(toWmoCode(321)).toBe(WMO.drizzleModerate)
  })

  it('maps snow by intensity, and snow showers apart from snowfall', () => {
    expect(toWmoCode(600)).toBe(WMO.snowSlight)
    expect(toWmoCode(601)).toBe(WMO.snowModerate)
    expect(toWmoCode(602)).toBe(WMO.snowHeavy)
    expect(toWmoCode(620)).toBe(WMO.snowShowersSlight)
    expect(toWmoCode(622)).toBe(WMO.snowShowersHeavy)
  })

  it('maps freezing precipitation to its own codes, not plain rain', () => {
    expect(toWmoCode(511)).toBe(WMO.freezingRain)
    expect(toWmoCode(611)).toBe(WMO.freezingRain)
    expect(toWmoCode(612)).toBe(WMO.freezingDrizzle)
  })

  it('maps thunderstorms, and hail separately', () => {
    expect(toWmoCode(200)).toBe(WMO.thunderstorm)
    expect(toWmoCode(211)).toBe(WMO.thunderstorm)
    expect(toWmoCode(202)).toBe(WMO.thunderstormHail)
    expect(toWmoCode(232)).toBe(WMO.thunderstormHail)
  })

  it('maps the whole atmosphere group to fog', () => {
    for (const id of [701, 711, 721, 731, 741, 751, 761, 762]) {
      expect(toWmoCode(id), `id ${id}`).toBe(WMO.fog)
    }
  })

  it('treats squalls and tornadoes as storms rather than haze', () => {
    expect(toWmoCode(771)).toBe(WMO.thunderstorm)
    expect(toWmoCode(781)).toBe(WMO.thunderstorm)
  })

  it('falls back to overcast for an unknown id rather than pretending it is clear', () => {
    // Drawing a sun for a condition we do not recognise is worse than
    // drawing a cloud.
    expect(toWmoCode(999)).toBe(WMO.overcast)
    expect(toWmoCode(0)).toBe(WMO.overcast)
  })
})
