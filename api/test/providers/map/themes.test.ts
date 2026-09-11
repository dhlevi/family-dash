import { describe, expect, it } from 'vitest'
import { ROAD_CLASS_TIERS, ROAD_TIERS, THEMES, themeById, themeIds } from '../../../lib/providers/map/themes'
import type { FillStyle, LineStyle } from '../../../lib/providers/map/themes'

const HEX = /^#[0-9a-f]{6}$/

function coloursOf(theme: (typeof THEMES)[number]): string[] {
  const styles: Array<FillStyle | LineStyle | undefined> = [
    theme.water,
    theme.waterway,
    theme.wood,
    theme.grass,
    theme.sand,
    theme.building,
    theme.boundary,
    ...Object.values(theme.roads)
  ]

  const colours = styles.filter(Boolean).map(style => style!.colour)
  const outlines = [theme.water, theme.wood, theme.grass, theme.sand, theme.building]
    .filter((style): style is FillStyle => Boolean(style?.outline))
    .map(style => style.outline!)

  return [theme.background, ...colours, ...outlines]
}

describe('THEMES', () => {
  it('has enough styles to be worth randomising', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10)
  })

  it('gives every theme a unique id', () => {
    expect(new Set(themeIds()).size).toBe(THEMES.length)
  })

  it.each(THEMES.map(theme => [theme.id, theme] as const))('%s uses only opaque six-digit hex', (_id, theme) => {
    // Not cosmetic. The renderer draws tiles without clipping them to their own
    // edges, so neighbouring tiles overdraw slightly; anything translucent
    // turns that overdraw into a visible grid across the picture.
    for (const colour of coloursOf(theme)) expect(colour).toMatch(HEX)
  })

  it.each(THEMES.map(theme => [theme.id, theme] as const))('%s styles every road tier', (_id, theme) => {
    // A missing tier is a whole class of road silently absent from the artwork.
    for (const tier of ROAD_TIERS) expect(theme.roads[tier], `${tier} is unstyled`).toBeDefined()
  })

  it.each(THEMES.map(theme => [theme.id, theme] as const))('%s widens roads by importance', (_id, theme) => {
    expect(theme.roads.motorway!.width).toBeGreaterThan(theme.roads.primary!.width)
    expect(theme.roads.primary!.width).toBeGreaterThan(theme.roads.minor!.width)
    expect(theme.roads.minor!.width).toBeGreaterThan(theme.roads.path!.width)
  })

  it('offers both a light and a dark mood', () => {
    const moods = new Set(THEMES.map(theme => theme.mood))

    expect(moods).toEqual(new Set(['light', 'dark']))
  })

  it('maps every road class onto a tier that exists', () => {
    for (const tier of Object.values(ROAD_CLASS_TIERS)) expect(ROAD_TIERS).toContain(tier)
  })

  it('covers the road classes OpenMapTiles actually emits', () => {
    for (const expected of [
      'motorway',
      'trunk',
      'primary',
      'secondary',
      'tertiary',
      'minor',
      'service',
      'path',
      'rail'
    ])
      expect(ROAD_CLASS_TIERS[expected]).toBeDefined()
  })
})

describe('themeById', () => {
  it('finds a theme', () => {
    expect(themeById('blueprint')?.name).toBe('Blueprint')
  })

  it('returns undefined for one that has been removed', () => {
    expect(themeById('no-such-theme')).toBeUndefined()
  })
})
