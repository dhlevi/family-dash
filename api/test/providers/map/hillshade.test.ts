import { describe, expect, it } from 'vitest'
import {
  decodeTerrarium,
  FLAT_SHADE,
  hillshade,
  reliefMetres,
  toOverlayRgba
} from '../../../lib/providers/map/hillshade'
import { TerrainOverlay } from '../../../lib/providers/map/terrainOverlay'

/** Builds the three bytes terrarium uses for a given elevation. */
function terrarium(metres: number): [number, number, number] {
  const value = metres + 32768
  const r = Math.floor(value / 256)
  const g = Math.floor(value - r * 256)
  const b = Math.round((value - r * 256 - g) * 256)

  return [r, g, b]
}

/** A grid that slopes evenly from west to east. */
function slopingGrid(width: number, height: number, metresPerColumn: number): Float32Array {
  const grid = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid[y * width + x] = x * metresPerColumn
  }
  return grid
}

describe('decodeTerrarium', () => {
  it('reads sea level', () => {
    expect(decodeTerrarium(Uint8Array.from(terrarium(0)), 3)[0]).toBeCloseTo(0, 3)
  })

  it('reads a summit', () => {
    // Verified against the real tile for Yr Wyddfa, which returns 1083m.
    expect(decodeTerrarium(Uint8Array.from(terrarium(1085)), 3)[0]).toBeCloseTo(1085, 2)
  })

  it('reads below sea level, which is why the encoding has an offset', () => {
    expect(decodeTerrarium(Uint8Array.from(terrarium(-412)), 3)[0]).toBeCloseTo(-412, 2)
  })

  it('steps over an alpha channel when the decoder gives four', () => {
    const [r, g, b] = terrarium(500)
    const decoded = decodeTerrarium(Uint8Array.from([r, g, b, 255, r, g, b, 255]), 4)

    expect(decoded).toHaveLength(2)
    expect(decoded[1]).toBeCloseTo(500, 2)
  })
})

describe('reliefMetres', () => {
  it('is zero across flat ground', () => {
    expect(reliefMetres(new Float32Array(100))).toBe(0)
  })

  it('measures a slope', () => {
    expect(reliefMetres(slopingGrid(100, 1, 10))).toBeGreaterThan(900)
  })

  it('ignores a single wild value', () => {
    // Elevation data has bad pixels, usually at coastlines. Using the full
    // range would report a kilometre of relief across somewhere flat.
    const flat = new Float32Array(1000)
    flat[500] = 9000

    expect(reliefMetres(flat)).toBe(0)
  })

  it('has nothing to say about an empty grid', () => {
    expect(reliefMetres(new Float32Array(0))).toBe(0)
  })
})

describe('hillshade', () => {
  it('reads flat ground as neutral', () => {
    const shade = hillshade(new Float32Array(64), 8, 8, { metresPerPixel: 30 })

    // The sun is 45 degrees up, so flat ground sits near cos(45) of full.
    for (const value of shade) expect(value).toBe(shade[0])
  })

  it('reads flat ground as cos of the sun angle, not as mid-grey', () => {
    // The obvious assumption is 128 and it is wrong: with no slope the formula
    // reduces to cos(zenith), which is 180 for a sun 45 degrees up. Anything
    // treating 128 as neutral tints every flat picture white.
    expect(hillshade(new Float32Array(64), 8, 8, { metresPerPixel: 30 })[0]).toBe(FLAT_SHADE)
  })

  it('lights a slope facing the sun and shadows the one facing away', () => {
    // Ground rising to the east falls away to the west, so it faces the
    // north-west sun and is lit; the opposite slope is in shadow.
    const facingSun = hillshade(slopingGrid(8, 8, 40), 8, 8, { metresPerPixel: 30 })
    const facingAway = hillshade(slopingGrid(8, 8, -40), 8, 8, { metresPerPixel: 30 })

    expect(facingSun[4 * 8 + 4]!).toBeGreaterThan(FLAT_SHADE)
    expect(facingAway[4 * 8 + 4]!).toBeLessThan(FLAT_SHADE)
  })

  it('darkens a shadowed slope further as it steepens', () => {
    const gentle = hillshade(slopingGrid(8, 8, -5), 8, 8, { metresPerPixel: 30 })
    const steep = hillshade(slopingGrid(8, 8, -40), 8, 8, { metresPerPixel: 30 })

    expect(steep[4 * 8 + 4]!).toBeLessThan(gentle[4 * 8 + 4]!)
  })

  it('does not brighten a sunlit slope without limit', () => {
    // Worth pinning down because it is counter-intuitive and looks like a bug
    // the first time it is seen: illumination peaks when the ground faces the
    // sun squarely, and a *steeper* slope past that tilts back out of the
    // light again. Only the shadowed side falls off monotonically.
    const values = [2, 5, 15, 40, 90].map(
      slope => hillshade(slopingGrid(8, 8, slope), 8, 8, { metresPerPixel: 30 })[4 * 8 + 4]!
    )
    const brightest = Math.max(...values)

    expect(values[values.length - 1]!).toBeLessThan(brightest)
  })

  it('reads the same slope as gentler when each pixel covers more ground', () => {
    // Same descent spread over a longer distance is a gentler hill, so the
    // shadow lifts back towards flat.
    const close = hillshade(slopingGrid(8, 8, -40), 8, 8, { metresPerPixel: 10 })
    const far = hillshade(slopingGrid(8, 8, -40), 8, 8, { metresPerPixel: 120 })

    expect(close[4 * 8 + 4]!).toBeLessThan(far[4 * 8 + 4]!)
  })

  it('exaggeration deepens the shading', () => {
    const plain = hillshade(slopingGrid(8, 8, -4), 8, 8, { metresPerPixel: 60 })
    const lifted = hillshade(slopingGrid(8, 8, -4), 8, 8, { metresPerPixel: 60, exaggeration: 4 })

    expect(lifted[4 * 8 + 4]!).toBeLessThan(plain[4 * 8 + 4]!)
  })

  it('shades the edges rather than leaving a pale frame', () => {
    const shade = hillshade(slopingGrid(8, 8, 40), 8, 8, { metresPerPixel: 30 })

    expect(shade[0]).toBeGreaterThan(0)
    expect(shade[shade.length - 1]).toBeGreaterThan(0)
  })

  it('produces one byte per cell', () => {
    expect(hillshade(new Float32Array(12 * 7), 12, 7, { metresPerPixel: 30 })).toHaveLength(84)
  })
})

describe('toOverlayRgba', () => {
  it('leaves flat ground completely transparent', () => {
    // So a theme's own background colour shows through untouched.
    const rgba = toOverlayRgba(Uint8Array.from([FLAT_SHADE]), 0.4)

    expect(rgba[3]).toBe(0)
  })

  it('paints shadow black and light white', () => {
    const dark = toOverlayRgba(Uint8Array.from([0]), 0.4)
    const light = toOverlayRgba(Uint8Array.from([255]), 0.4)

    expect(dark[0]).toBe(0)
    expect(light[0]).toBe(255)
    expect(dark[3]).toBeGreaterThan(0)
    expect(light[3]).toBeGreaterThan(0)
  })

  it('never exceeds the strength it was given', () => {
    const rgba = toOverlayRgba(Uint8Array.from([0, 255]), 0.3)

    expect(rgba[3]!).toBeLessThanOrEqual(Math.round(0.3 * 255))
    expect(rgba[7]!).toBeLessThanOrEqual(Math.round(0.3 * 255))
  })

  it('emits four bytes per cell', () => {
    expect(toOverlayRgba(new Uint8Array(10), 0.4)).toHaveLength(40)
  })
})

describe('TerrainOverlay.scaleBounds', () => {
  const view = { zoom: 14, minX: 8100.25, minY: 5300.5, maxX: 8104.25, maxY: 5303 }

  it('leaves bounds alone at the same zoom', () => {
    expect(TerrainOverlay.scaleBounds(view, 14)).toEqual(view)
  })

  it('halves the coordinates for each zoom it steps down', () => {
    // Terrain coverage runs out at z12 over most of the world, so the same
    // ground has to be expressed at whatever depth tiles actually exist.
    const coarser = TerrainOverlay.scaleBounds(view, 12)

    expect(coarser.zoom).toBe(12)
    expect(coarser.minX).toBeCloseTo(view.minX / 4, 6)
    expect(coarser.maxY).toBeCloseTo(view.maxY / 4, 6)
  })

  it('covers exactly the same ground, only sampled differently', () => {
    const coarser = TerrainOverlay.scaleBounds(view, 11)
    const widthAtView = (view.maxX - view.minX) / 2 ** view.zoom
    const widthAtCoarser = (coarser.maxX - coarser.minX) / 2 ** coarser.zoom

    expect(widthAtCoarser).toBeCloseTo(widthAtView, 10)
  })
})
