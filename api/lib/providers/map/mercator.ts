/**
 * Web Mercator, in tile units.
 *
 * Everything here works in the coordinate system the tile pyramid uses: at
 * zoom `z` the world is a 2^z square, so a position is a fractional tile index
 * and the integer part of it names the tile you need to fetch. Keeping the
 * whole pipeline in these units means there is exactly one conversion.
 */

/** The equatorial circumference, in metres. Used to turn a span into a zoom. */
const EQUATORIAL_METRES = 40_075_016.686

/** OpenFreeMap's planet tiles stop here; asking for more returns nothing. */
export const MAX_ZOOM = 14
export const MIN_ZOOM = 8

/** The latitude beyond which Web Mercator stops being defined. */
const MAX_LATITUDE = 85.051_128_78

export interface TilePoint {
  x: number
  y: number
}

/** A rectangle in tile units at a given zoom. */
export interface TileBounds {
  zoom: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function clampLatitude(latitude: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, latitude))
}

/**
 * Degrees to fractional tile coordinates at `zoom`.
 *
 * `y` is clamped into the world square as well as being derived from a clamped
 * latitude. At the very edge the arithmetic lands a fraction either side of the
 * boundary, a latitude of 89.9 comes out at -1e-10 rather than 0, and that is
 * enough for `Math.floor` to name tile row -1, which does not exist.
 */
export function project(latitude: number, longitude: number, zoom: number): TilePoint {
  const scale = 2 ** zoom
  const lat = (clampLatitude(latitude) * Math.PI) / 180
  const y = ((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * scale

  return {
    x: ((longitude + 180) / 360) * scale,
    y: Math.min(scale, Math.max(0, y))
  }
}

/**
 * How many metres of ground one tile covers, east to west, at this latitude.
 *
 * Mercator stretches with latitude, so a tile over Whitehorse covers far less
 * ground than one over Singapore. Choosing a zoom from a distance in
 * kilometres has to account for that or every northern city comes out zoomed
 * further in than intended.
 */
export function tileWidthMetres(latitude: number, zoom: number): number {
  return (EQUATORIAL_METRES * Math.cos((clampLatitude(latitude) * Math.PI) / 180)) / 2 ** zoom
}

/**
 * The zoom at which a span of `spanMetres` fills roughly `targetTiles` tiles.
 *
 * The renderer wants a predictable amount of *detail*, not a predictable
 * amount of ground: too far out and OpenStreetMap's generalisation has thrown
 * away the residential streets that make these pictures worth looking at, too
 * far in and a city becomes a handful of arterials. Aiming for a fixed number
 * of tiles across the frame keeps the linework consistent whether the subject
 * is London or Ucluelet.
 */
export function zoomForSpan(latitude: number, spanMetres: number, targetTiles: number): number {
  const exact = Math.log2(
    (targetTiles * EQUATORIAL_METRES * Math.cos((clampLatitude(latitude) * Math.PI) / 180)) / spanMetres
  )

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(exact)))
}

export interface ViewOptions {
  /** How many tiles wide the frame should be, before the budget is applied. */
  targetTiles?: number
  /**
   * The most tiles one picture may cost.
   *
   * Rounding to a whole zoom can land either side of the target, and landing
   * above it is expensive in a way that is easy to miss: half a zoom level too
   * far in quadruples the tile count. Paris at its ideal span wanted thirty
   * tiles and eighteen megabytes before this existed. Dropping a level costs
   * some fine detail and is the right trade for a picture seen from across a
   * room, and for a tile server being given away for free.
   */
  maxTiles?: number
}

const DEFAULT_TARGET_TILES = 4
const DEFAULT_MAX_TILES = 20

/**
 * The view rectangle for one artwork.
 *
 * Centred on the city, `spanMetres` wide, and with the aspect ratio of the
 * output so nothing has to be cropped afterwards. Height comes from the width
 * rather than from its own distance, because a portrait panel should show the
 * same streets as a landscape one, taller.
 *
 * The zoom steps down until the view fits the tile budget, so the ground
 * covered is always what was asked for and only the detail gives way.
 */
export function boundsFor(
  latitude: number,
  longitude: number,
  spanMetres: number,
  width: number,
  height: number,
  options: ViewOptions = {}
): TileBounds {
  const targetTiles = options.targetTiles ?? DEFAULT_TARGET_TILES
  const maxTiles = options.maxTiles ?? DEFAULT_MAX_TILES

  let zoom = zoomForSpan(latitude, spanMetres, targetTiles)
  let bounds = viewAt(latitude, longitude, spanMetres, width, height, zoom)

  while (zoom > MIN_ZOOM && tilesCovering(bounds).length > maxTiles) {
    zoom--
    bounds = viewAt(latitude, longitude, spanMetres, width, height, zoom)
  }

  return bounds
}

function viewAt(
  latitude: number,
  longitude: number,
  spanMetres: number,
  width: number,
  height: number,
  zoom: number
): TileBounds {
  const centre = project(latitude, longitude, zoom)
  const halfWidth = spanMetres / tileWidthMetres(latitude, zoom) / 2
  const halfHeight = halfWidth * (height / width)

  return {
    zoom,
    minX: centre.x - halfWidth,
    minY: centre.y - halfHeight,
    maxX: centre.x + halfWidth,
    maxY: centre.y + halfHeight
  }
}

export interface TileId {
  zoom: number
  x: number
  y: number
}

/**
 * Every tile the view touches.
 *
 * Wraps in x so a view straddling the antimeridian still works, and clamps in
 * y because there are no tiles above the pole.
 */
export function tilesCovering(bounds: TileBounds): TileId[] {
  const scale = 2 ** bounds.zoom
  const tiles: TileId[] = []

  for (let y = Math.floor(bounds.minY); y <= Math.floor(bounds.maxY); y++) {
    if (y < 0 || y >= scale) continue

    for (let x = Math.floor(bounds.minX); x <= Math.floor(bounds.maxX); x++) {
      tiles.push({ zoom: bounds.zoom, x: ((x % scale) + scale) % scale, y })
    }
  }

  return tiles
}
