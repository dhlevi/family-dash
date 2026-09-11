/**
 * The look of a generated map.
 *
 * A theme is pure data: colours and stroke widths, no logic. That is what
 * makes adding one a two-minute job and what lets the Settings page describe
 * the set without importing the renderer.
 *
 * **Every colour here must be fully opaque.** The renderer draws tiles without
 * clipping them to their own edges, because vector tiles carry a small margin
 * of their neighbours' geometry and clipping that away leaves hairline seams
 * along every tile boundary. Overdrawing is invisible with opaque paint and
 * shows up as a faint grid with anything translucent, so where a theme wants a
 * washed-out building fill it states the blended colour rather than an alpha.
 *
 * Widths are in output pixels at a reference width of 2000px and are scaled to
 * the real canvas by the renderer, so a theme looks the same on a portrait
 * panel as on a landscape one.
 */

/** Road groupings, coarser than OpenStreetMap's classes and drawn in this order. */
export const ROAD_TIERS = [
  'path',
  'rail',
  'service',
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway'
] as const

export type RoadTier = (typeof ROAD_TIERS)[number]

/** OpenMapTiles `transportation.class` values, mapped onto the tiers above. */
export const ROAD_CLASS_TIERS: Record<string, RoadTier> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  minor: 'minor',
  busway: 'minor',
  bus_guideway: 'minor',
  service: 'service',
  path: 'path',
  track: 'path',
  rail: 'rail',
  transit: 'rail'
}

export interface LineStyle {
  colour: string
  /** Output pixels at a 2000px-wide canvas. */
  width: number
  /** SVG `stroke-dasharray`, in the same reference units. */
  dash?: string
}

export interface FillStyle {
  colour: string
  outline?: string
  outlineWidth?: number
}

export interface MapTheme {
  id: string
  name: string
  description: string
  /** Whether this suits a lit room or a dark one. */
  mood: 'light' | 'dark'
  /** Also handed to the UI, which paints it behind an artwork while it loads. */
  background: string
  water?: FillStyle
  waterway?: LineStyle
  wood?: FillStyle
  grass?: FillStyle
  sand?: FillStyle
  building?: FillStyle
  boundary?: LineStyle
  roads: Partial<Record<RoadTier, LineStyle>>
}

/**
 * The default road ramp, as a starting point for themes that only want to
 * change the colour. Widths taper by an order of magnitude from motorway to
 * footpath, which is what gives these pictures their structure at a glance.
 */
function ramp(colour: string, scale = 1): Partial<Record<RoadTier, LineStyle>> {
  return {
    path: { colour, width: 0.45 * scale },
    rail: { colour, width: 0.7 * scale },
    service: { colour, width: 0.55 * scale },
    minor: { colour, width: 0.95 * scale },
    tertiary: { colour, width: 1.5 * scale },
    secondary: { colour, width: 2.1 * scale },
    primary: { colour, width: 2.7 * scale },
    trunk: { colour, width: 3.3 * scale },
    motorway: { colour, width: 4.1 * scale }
  }
}

export const THEMES: MapTheme[] = [
  {
    id: 'blueprint',
    name: 'Blueprint',
    description: 'White linework on drafting blue.',
    mood: 'dark',
    background: '#0d2b45',
    water: { colour: '#164667' },
    waterway: { colour: '#164667', width: 0.9 },
    roads: ramp('#e8f1f8')
  },
  {
    id: 'ink',
    name: 'Ink on Paper',
    description: 'Black pen on warm cartridge paper.',
    mood: 'light',
    background: '#f4efe4',
    water: { colour: '#d9d2c2' },
    waterway: { colour: '#c6bda9', width: 0.9 },
    wood: { colour: '#e6e3d2' },
    grass: { colour: '#ecead9' },
    roads: ramp('#1c1a17')
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Amber streets on near-black. Kind to a dark kitchen.',
    mood: 'dark',
    background: '#07070a',
    water: { colour: '#0e1420' },
    waterway: { colour: '#16202f', width: 0.9 },
    roads: ramp('#f0a33c')
  },
  {
    id: 'nautical',
    name: 'Nautical',
    description: 'Admiralty chart: pale land, deep water, navy roads.',
    mood: 'light',
    background: '#f0e7d2',
    water: { colour: '#1d5a72' },
    waterway: { colour: '#2c7490', width: 1 },
    sand: { colour: '#e6d8b8' },
    roads: ramp('#1b3a52')
  },
  {
    id: 'copper',
    name: 'Copper',
    description: 'Oxidised metal on slate.',
    mood: 'dark',
    background: '#1f1d1b',
    water: { colour: '#2b2926' },
    waterway: { colour: '#3a3733', width: 0.9 },
    roads: ramp('#c87d3f')
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Soft greens and chalk. Quiet at any hour.',
    mood: 'light',
    background: '#eef0e8',
    water: { colour: '#c4d3cd' },
    waterway: { colour: '#adc0b9', width: 0.9 },
    wood: { colour: '#dbe3d4' },
    grass: { colour: '#e4e9dd' },
    roads: ramp('#4a5a4c')
  },
  {
    id: 'mono',
    name: 'Monochrome',
    description: 'The classic: black roads, white ground, nothing else.',
    mood: 'light',
    background: '#ffffff',
    water: { colour: '#e9e9e9' },
    waterway: { colour: '#dcdcdc', width: 0.9 },
    roads: ramp('#111111')
  },
  {
    id: 'inverse',
    name: 'Inverse',
    description: 'Monochrome, turned inside out.',
    mood: 'dark',
    background: '#0a0a0a',
    water: { colour: '#1a1a1a' },
    waterway: { colour: '#242424', width: 0.9 },
    roads: ramp('#f2f2f2')
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Magenta arterials, cyan water, black sky.',
    mood: 'dark',
    background: '#05040a',
    water: { colour: '#0a2230' },
    waterway: { colour: '#14425a', width: 1 },
    roads: {
      ...ramp('#ff2fb4'),
      path: { colour: '#5d2a55', width: 0.45 },
      service: { colour: '#7a2f68', width: 0.55 },
      rail: { colour: '#2ce8e0', width: 0.8 },
      minor: { colour: '#a8309a', width: 0.95 }
    }
  },
  {
    id: 'parchment',
    name: 'Parchment',
    description: 'Sepia and age, as if it had been folded in a drawer.',
    mood: 'light',
    background: '#e8dcc0',
    water: { colour: '#bfa877' },
    waterway: { colour: '#b6a87f', width: 0.9 },
    wood: { colour: '#dcd0b0' },
    grass: { colour: '#e2d7b9' },
    roads: ramp('#5a4632')
  },
  {
    id: 'arctic',
    name: 'Arctic',
    description: 'Ice blue and white, with barely any contrast at all.',
    mood: 'light',
    background: '#f7fbfd',
    water: { colour: '#cfe4ef' },
    waterway: { colour: '#bcd8e6', width: 0.9 },
    wood: { colour: '#e8f1f5' },
    roads: ramp('#5b7d91')
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Charcoal with a fire in it.',
    mood: 'dark',
    background: '#14100e',
    water: { colour: '#1c1815' },
    waterway: { colour: '#2a241f', width: 0.9 },
    // The base of this ramp is deliberately not as dark as the gradient
    // suggests it should be. A theme whose quiet roads fade into the
    // background looks magnificent over Turin and turns a Welsh market town
    // into a black rectangle, because in a small place almost every road is a
    // minor one — and small places are half the point of the city list.
    roads: {
      ...ramp('#b0663a'),
      tertiary: { colour: '#c26a2c', width: 1.5 },
      secondary: { colour: '#cf6329', width: 2.1 },
      primary: { colour: '#e8802f', width: 2.7 },
      trunk: { colour: '#f59b39', width: 3.3 },
      motorway: { colour: '#ffb648', width: 4.1 }
    }
  }
]

export const DEFAULT_THEME = 'blueprint'

export function themeById(id: string): MapTheme | undefined {
  return THEMES.find(theme => theme.id === id)
}

export function themeIds(): string[] {
  return THEMES.map(theme => theme.id)
}
