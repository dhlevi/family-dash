/**
 * Shaded relief, from terrain tiles.
 *
 * The line art is deliberately flat, and over a dense city that is right as
 * there is no room for anything underneath twelve thousand streets. Over a
 * coastal village or a valley town, most of the picture is empty background,
 * and the landscape those places are shaped by is the obvious thing to put
 * there.
 *
 * Everything here is arithmetic on an elevation grid: decoding, the shading
 * itself, and the measure used to decide whether a place has any relief worth
 * drawing. Fetching and image encoding live elsewhere so this stays testable.
 */

/** Where the sun is, in the convention every GIS hillshade uses. */
const AZIMUTH_DEGREES = 315
const ALTITUDE_DEGREES = 45

/**
 * What perfectly flat ground comes out as.
 *
 * Not the middle of the range, which is the easy assumption and a wrong one:
 * the formula reduces to cos(zenith) where there is no slope, so with the sun
 * 45 degrees up flat ground is 180, not 128. Treating 128 as neutral washes
 * every flat picture over with white.
 *
 * It also means the two sides are not the same size, 180 of shadow against
 * 75 of light, so anything normalising around it has to scale each
 * separately.
 */
export const FLAT_SHADE = Math.round(Math.cos(((90 - ALTITUDE_DEGREES) * Math.PI) / 180) * 255)

export interface ShadeOptions {
  /** Ground distance one pixel covers. Sets how steep the terrain reads. */
  metresPerPixel: number
  /**
   * Vertical exaggeration.
   *
   * Above 1 because a hillshade computed at true scale over a 10km view is
   * almost flat: the eye reads relief from contrast, and the honest version
   * has very little.
   */
  exaggeration?: number
}

/**
 * Terrarium elevation encoding, as served by Mapterhorn.
 *
 *   metres = R * 256 + G + B / 256 - 32768
 *
 * The offset is what lets it carry depths below sea level in unsigned bytes.
 * Verified against Yr Wyddfa, which came back at 1083m for a summit of 1085.
 */
export function decodeTerrarium(pixels: Uint8Array | Buffer, channels: number): Float32Array {
  const count = Math.floor(pixels.length / channels)
  const elevations = new Float32Array(count)

  for (let index = 0; index < count; index++) {
    const at = index * channels
    elevations[index] = pixels[at]! * 256 + pixels[at + 1]! + pixels[at + 2]! / 256 - 32768
  }

  return elevations
}

/**
 * How much the ground moves across a grid, ignoring the extremes.
 */
export function reliefMetres(elevations: Float32Array): number {
  if (elevations.length === 0) return 0

  const sorted = Float32Array.from(elevations).sort()
  const low = sorted[Math.floor(sorted.length * 0.02)] ?? 0
  const high = sorted[Math.floor(sorted.length * 0.98)] ?? 0

  return Math.max(0, high - low)
}

/**
 * Horn's method: shade each cell from the slope and aspect of its neighbours.
 *
 * Returns one byte per cell, 0 (deep shadow) to 255 (full light), with 128
 * meaning flat ground. The caller turns that into something to look at.
 *
 * Edge cells reuse their nearest neighbour rather than being left blank, which
 * avoids a one-pixel frame of un-shaded ground around every picture.
 */
export function hillshade(elevations: Float32Array, width: number, height: number, options: ShadeOptions): Uint8Array {
  const shade = new Uint8Array(width * height)
  const exaggeration = options.exaggeration ?? 1
  const scale = exaggeration / (8 * options.metresPerPixel)

  const zenith = ((90 - ALTITUDE_DEGREES) * Math.PI) / 180
  const azimuth = ((360 - AZIMUTH_DEGREES + 90) * Math.PI) / 180
  const cosZenith = Math.cos(zenith)
  const sinZenith = Math.sin(zenith)

  const at = (x: number, y: number): number =>
    elevations[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = at(x - 1, y - 1)
      const b = at(x, y - 1)
      const c = at(x + 1, y - 1)
      const d = at(x - 1, y)
      const f = at(x + 1, y)
      const g = at(x - 1, y + 1)
      const h = at(x, y + 1)
      const i = at(x + 1, y + 1)

      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) * scale
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) * scale

      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)

      const value = cosZenith * Math.cos(slope) + sinZenith * Math.sin(slope) * Math.cos(azimuth - aspect)

      shade[y * width + x] = Math.max(0, Math.min(255, Math.round(value * 255)))
    }
  }

  return shade
}

/**
 * Turns shade into something that can sit under the linework.
 *
 * Black where the ground falls away and white where it catches the light,
 * both with an alpha that fades to nothing on the flat. Painting a grey image
 * instead would wash the theme's own background out to the same colour in
 * every style; this leaves the hue alone and only varies the light, so
 * Blueprint stays blue and Parchment stays parchment.
 */
export function toOverlayRgba(shade: Uint8Array, strength: number): Buffer {
  const rgba = Buffer.alloc(shade.length * 4)

  for (let index = 0; index < shade.length; index++) {
    const value = shade[index]!
    const lit = value > FLAT_SHADE

    // -1 fully shadowed, 0 flat, +1 fully lit. Each side is scaled by its own
    // span because they are not equal either side of flat.
    const signed = lit ? (value - FLAT_SHADE) / (255 - FLAT_SHADE) : (value - FLAT_SHADE) / FLAT_SHADE

    const at = index * 4
    const tone = lit ? 255 : 0
    rgba[at] = tone
    rgba[at + 1] = tone
    rgba[at + 2] = tone
    rgba[at + 3] = Math.max(0, Math.min(255, Math.round(Math.abs(signed) * strength * 255)))
  }

  return rgba
}
