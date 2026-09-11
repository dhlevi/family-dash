import sharp from 'sharp'
import { AppProperties } from '../../core/AppProperties'
import { decodeTerrarium, hillshade, reliefMetres, toOverlayRgba } from './hillshade'
import { tileWidthMetres, tilesCovering, type TileBounds } from './mercator'
import { TerrainSource } from './TerrainSource'

/**
 * Builds the shaded-relief underlay for one artwork.
 *
 * Stitches the terrain tiles covering the view into a single elevation grid,
 * shades it, crops to the exact frame and hands back an SVG `<image>` to drop
 * beneath the linework.
 *
 * The image is embedded rather than linked. An artwork has to keep working
 * with no network (it is the screensaver) and a linked tile would be a
 * broken image on the wall the first time the wifi dropped. It is also
 * deliberately much smaller than the canvas: a hillshade is all soft gradients,
 * so it upscales without anyone noticing, and full resolution would put several
 * megabytes of base64 into a file that is meant to be handed to a printer.
 */

export interface HillshadeResult {
  /** An `<image>` element, ready to splice under the map. */
  fragment: string
  /** How much the ground actually moves, for logging and for the decision. */
  reliefMetres: number
}

/** Longest edge of the embedded image. Soft gradients survive the upscale. */
const OVERLAY_PIXELS = 600

export class TerrainOverlay {
  public static strength(): number {
    return AppProperties.getNumber('cityart.hillshade.strength', 0.45)
  }

  public static exaggeration(): number {
    return AppProperties.getNumber('cityart.hillshade.exaggeration', 1.6)
  }

  /** Below this, the ground is flat enough that shading it adds only noise. */
  public static minRelief(): number {
    return AppProperties.getNumber('cityart.hillshade.minReliefMetres', 120)
  }

  /** Above this many features there is no visible background left to shade. */
  public static maxFeatures(): number {
    return AppProperties.getNumber('cityart.hillshade.maxFeatures', 2500)
  }

  /**
   * Fetches, shades and crops.
   *
   * Returns null whenever a hillshade would not be worth having,
   * rather than an empty image, so the caller can record that the 
   * artwork simply has none.
   */
  public static async build(
    bounds: TileBounds,
    latitude: number,
    width: number,
    height: number,
    mood: 'light' | 'dark' = 'light'
  ): Promise<HillshadeResult | null> {
    if (!TerrainSource.enabled()) return null

    const view = tilesCovering(bounds)
    if (view.length === 0) return null

    // Terrain coverage thins out at high zoom outside the countries with their
    // own surveys, so ask what is actually there before fetching twenty tiles
    // that do not exist.
    const centre = view[Math.floor(view.length / 2)]!
    const zoom = await TerrainSource.deepestZoom(bounds.zoom, centre)
    if (zoom === null) return null

    const terrain = TerrainOverlay.scaleBounds(bounds, zoom)
    const ids = tilesCovering(terrain)
    if (ids.length === 0) return null

    const tiles = await TerrainSource.fetchTiles(ids)
    if (tiles.length === 0) return null

    const size = TerrainSource.TILE_PIXELS
    const originX = Math.floor(terrain.minX)
    const originY = Math.floor(terrain.minY)
    const tilesAcross = Math.floor(terrain.maxX) - originX + 1
    const tilesDown = Math.floor(terrain.maxY) - originY + 1

    const gridWidth = tilesAcross * size
    const gridHeight = tilesDown * size
    const elevations = new Float32Array(gridWidth * gridHeight)

    // Which squares actually arrived. An absent tile leaves its block at zero
    // metres, and the join between that and real ground is a "cliff"; a hard 
    // black edge straight across the picture. Unsurveyed ocean and the far 
    // north are where this has the greatest effect.
    const covered = new Uint8Array(tilesAcross * tilesDown)

    const scale = 2 ** terrain.zoom

    for (const tile of tiles) {
      let decoded
      try {
        decoded = await sharp(Buffer.from(tile.data)).raw().toBuffer({ resolveWithObject: true })
      } catch {
        // A tile that will not decode costs its own square, not the picture.
        continue
      }

      const heights = decodeTerrarium(decoded.data, decoded.info.channels)

      // `tilesCovering` wraps x around the antimeridian, so the column has to
      // be recovered from the wrapped value rather than assumed.
      const column = (((tile.id.x - originX) % scale) + scale) % scale
      const offsetX = column * size
      const offsetY = (tile.id.y - originY) * size
      if (offsetX >= gridWidth || offsetY >= gridHeight) continue

      for (let y = 0; y < decoded.info.height; y++) {
        const target = (offsetY + y) * gridWidth + offsetX
        elevations.set(heights.subarray(y * decoded.info.width, (y + 1) * decoded.info.width), target)
      }

      covered[(offsetY / size) * tilesAcross + offsetX / size] = 1
    }

    const gaps = covered.length - covered.reduce((total, value) => total + value, 0)

    // Relief is measured over the ground that is actually there. Counting the
    // zero-filled gaps would report hundreds of metres of relief across
    // somewhere flat, and let a picture through that should not have one.
    const relief = reliefMetres(TerrainOverlay.coveredOnly(elevations, covered, tilesAcross, size, gridWidth))
    if (relief < TerrainOverlay.minRelief()) return null

    const metresPerPixel = tileWidthMetres(latitude, terrain.zoom) / size
    const shade = hillshade(elevations, gridWidth, gridHeight, {
      metresPerPixel,
      exaggeration: TerrainOverlay.exaggeration()
    })

    // Easier on a dark theme. The overlay lifts sunlit ground towards white,
    // and against a near-black background that is a far bigger jump than the
    // same strength makes on paper.
    const strength = TerrainOverlay.strength() * (mood === 'dark' ? 0.6 : 1)
    const rgba = toOverlayRgba(shade, strength)

    if (gaps > 0) TerrainOverlay.clearUncovered(rgba, covered, tilesAcross, size, gridWidth, gridHeight)

    // Crop to the view, which sits at a fraction of a tile inside the grid.
    const left = Math.round((terrain.minX - originX) * size)
    const top = Math.round((terrain.minY - originY) * size)
    const cropWidth = Math.max(1, Math.min(gridWidth - left, Math.round((terrain.maxX - terrain.minX) * size)))
    const cropHeight = Math.max(1, Math.min(gridHeight - top, Math.round((terrain.maxY - terrain.minY) * size)))

    const longest = width >= height ? OVERLAY_PIXELS : Math.round((OVERLAY_PIXELS * width) / height)

    const png = await sharp(rgba, { raw: { width: gridWidth, height: gridHeight, channels: 4 } })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(longest, null, { fit: 'fill' })
      // A palette halves the embedded bytes, and the image is only ever black
      // or white with a varying alpha, far less than a palette can hold, so
      // there is nothing for the quantiser to lose.
      .png({ compressionLevel: 9, palette: true, colours: 64 })
      .toBuffer()

    const fragment =
      `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" ` +
      `href="data:image/png;base64,${png.toString('base64')}"/>`

    return { fragment, reliefMetres: relief }
  }

  /**
   * The same ground, expressed in tile coordinates at another zoom.
   *
   * Tile coordinates are just the world scaled to 2^zoom, so moving between
   * zooms is one multiplication, which is what lets the terrain be fetched at
   * whatever depth it exists at while still framing the view exactly.
   */
  public static scaleBounds(bounds: TileBounds, zoom: number): TileBounds {
    const factor = 2 ** (zoom - bounds.zoom)

    return {
      zoom,
      minX: bounds.minX * factor,
      minY: bounds.minY * factor,
      maxX: bounds.maxX * factor,
      maxY: bounds.maxY * factor
    }
  }

  /** Whether a picture this sparse over ground this varied should get one. */
  public static suits(featureCount: number): boolean {
    return featureCount <= TerrainOverlay.maxFeatures()
  }

  /** The elevations from squares that actually arrived, for measuring relief. */
  private static coveredOnly(
    elevations: Float32Array,
    covered: Uint8Array,
    tilesAcross: number,
    size: number,
    gridWidth: number
  ): Float32Array {
    if (covered.every(value => value === 1)) return elevations

    const kept: number[] = []
    for (let index = 0; index < covered.length; index++) {
      if (covered[index] !== 1) continue

      const left = (index % tilesAcross) * size
      const top = Math.floor(index / tilesAcross) * size

      // Every eighth row and column is plenty to characterise a tile, and
      // keeps this from allocating the whole grid a second time.
      for (let y = top; y < top + size; y += 8) {
        for (let x = left; x < left + size; x += 8) kept.push(elevations[y * gridWidth + x]!)
      }
    }

    return Float32Array.from(kept)
  }

  /** Makes the squares that never arrived fully transparent. */
  private static clearUncovered(
    rgba: Buffer,
    covered: Uint8Array,
    tilesAcross: number,
    size: number,
    gridWidth: number,
    gridHeight: number
  ): void {
    for (let index = 0; index < covered.length; index++) {
      if (covered[index] === 1) continue

      const left = (index % tilesAcross) * size
      const top = Math.floor(index / tilesAcross) * size

      for (let y = top; y < Math.min(top + size, gridHeight); y++) {
        for (let x = left; x < Math.min(left + size, gridWidth); x++) rgba[(y * gridWidth + x) * 4 + 3] = 0
      }
    }
  }
}
