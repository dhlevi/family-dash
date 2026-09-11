import { decodeTile, GeometryType, type VectorFeature } from './VectorTile'
import { lineLength, ringArea, simplify } from './simplify'
import { ROAD_CLASS_TIERS, ROAD_TIERS, type FillStyle, type LineStyle, type MapTheme } from './themes'
import type { TileBounds, TileId } from './mercator'

/**
 * Turns vector tiles into a single SVG poster.
 *
 * The output is deliberately a handful of very long paths rather than tens of
 * thousands of small elements: everything sharing a colour and a width is
 * concatenated into one `d`, which is both a fraction of the bytes and far
 * less work for a renderer than the equivalent element tree. A city typically
 * comes out as a dozen `<path>` elements.
 *
 * Tiles are *not* clipped to their own edges. They carry a margin of their
 * neighbours' geometry, so drawing them whole means a little overdraw along
 * every seam.
 */

export interface FetchedTile {
  id: TileId
  data: Uint8Array
}

export interface RenderOptions {
  theme: MapTheme
  width: number
  height: number
}

export interface RenderedMap {
  svg: string
  /** How much was actually drawn, for spotting a city with no data behind it. */
  featureCount: number
}

/** Where {@link withUnderlay} puts a hillshade. Replaced, or stripped. */
const UNDERLAY_MARKER = '<!--underlay-->'

/**
 * Puts something beneath the linework, currently used for hillshade.
 *
 * Splicing into a marker rather than re-rendering, because whether a picture
 * gets one depends on how sparse it turned out to be, which is only known once
 * it has been drawn. Passing no fragment removes the marker, so an SVG never
 * carries a stray comment.
 */
export function withUnderlay(svg: string, fragment: string | null): string {
  return svg.replace(UNDERLAY_MARKER, fragment ?? '')
}

/** The properties any style decision here depends on. Nothing else is decoded. */
const WANTED_KEYS: ReadonlySet<string> = new Set(['class', 'subclass'])

/** Geometry finer than this, in output pixels, cannot be seen. */
const SIMPLIFY_TOLERANCE = 0.3

/** Shapes smaller than this, in output pixels, are noise. */
const MIN_AREA = 2
const MIN_LENGTH = 1.5

/** Landcover classes worth colouring, grouped onto the three fills a theme has. */
const LANDCOVER_GROUPS: Record<string, 'wood' | 'grass' | 'sand'> = {
  wood: 'wood',
  forest: 'wood',
  grass: 'grass',
  farmland: 'grass',
  meadow: 'grass',
  wetland: 'grass',
  sand: 'sand',
  rock: 'sand',
  ice: 'sand'
}

/** One drawable bucket: a style, and every path that shares it. */
interface Bucket {
  /** Position in the painter's order. Buckets are emitted sorted by this. */
  rank: number
  attributes: string
  parts: string[]
}

/**
 * Painter's order, bottom first. Roads come last and in tier order so that a
 * motorway crosses over a lane rather than under it.
 */
const PAINT_ORDER = [
  'land-wood',
  'land-grass',
  'land-sand',
  'water',
  'waterway',
  'building',
  'boundary',
  ...ROAD_TIERS.map(tier => `road-${tier}`)
]

/**
 * Where the hillshade goes: above the ground cover, below the water.
 *
 * Not at the very bottom, which is the obvious place and the wrong one. Wood,
 * grass and sand are opaque fills. They have to be, because tiles are drawn
 * unclipped and anything translucent turns the overdraw along every tile
 * boundary into a visible grid, so a hillshade underneath them comes out as
 * shaded ground interrupted by flat slabs of colour wherever a forest or a
 * meadow happens to be.
 *
 * Putting it above them is also what every printed map does: relief shades the
 * land, and water, buildings and roads sit on top of it. A lake stays flat
 * because a lake *is* flat.
 */
const UNDERLAY_AFTER = PAINT_ORDER.indexOf('water')

/** Where a bucket sits in {@link PAINT_ORDER}, ignoring any per-tile suffix. */
function rankOf(key: string): number {
  const base = key.includes('@') ? key.slice(0, key.indexOf('@')) : key
  const index = PAINT_ORDER.indexOf(base)
  return index === -1 ? PAINT_ORDER.length : index
}

/** Coordinates are rounded to a tenth of a pixel; beyond that is wasted bytes. */
function format(value: number): string {
  const text = (Math.round(value * 10) / 10).toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/**
 * A ring or line as SVG path data.
 *
 * Coordinate pairs after the first `L` are implicit line-tos, which is the
 * shortest legal encoding and saves a character per point across a few hundred
 * thousand of them.
 */
function pathData(coordinates: number[], close: boolean): string {
  let data = `M${format(coordinates[0]!)} ${format(coordinates[1]!)}`

  if (coordinates.length > 2) {
    data += 'L'
    for (let index = 2; index < coordinates.length; index += 2) {
      data += `${index > 2 ? ' ' : ''}${format(coordinates[index]!)} ${format(coordinates[index + 1]!)}`
    }
  }

  return close ? `${data}Z` : data
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderMapArt(tiles: FetchedTile[], bounds: TileBounds, options: RenderOptions): RenderedMap {
  const { theme, width, height } = options

  // Theme widths are quoted against a 2000px canvas so that the same numbers
  // frame a portrait panel and a landscape one identically.
  const strokeScale = width / 2000
  const scale = width / (bounds.maxX - bounds.minX)

  const wantedLayers = new Set<string>(['transportation'])
  if (theme.water) wantedLayers.add('water')
  if (theme.waterway) wantedLayers.add('waterway')
  if (theme.wood || theme.grass || theme.sand) wantedLayers.add('landcover')
  if (theme.grass) wantedLayers.add('park')
  if (theme.building) wantedLayers.add('building')
  if (theme.boundary) wantedLayers.add('boundary')

  const buckets = new Map<string, Bucket>()
  let featureCount = 0

  function bucketFor(key: string, attributes: string): Bucket {
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { rank: rankOf(key), attributes, parts: [] }
      buckets.set(key, bucket)
    }
    return bucket
  }

  function fillAttributes(style: FillStyle): string {
    const outline =
      style.outline && style.outlineWidth
        ? ` stroke="${style.outline}" stroke-width="${format(style.outlineWidth * strokeScale)}"`
        : ''
    // Even-odd means polygon holes work without inspecting ring winding, and
    // it is also what makes concatenating unrelated polygons into one path
    // safe: two separate islands never punch each other out.
    return `fill="${style.colour}" fill-rule="evenodd"${outline}`
  }

  function lineAttributes(style: LineStyle): string {
    const dash = style.dash
      ? ` stroke-dasharray="${style.dash
          .split(/[\s,]+/)
          .map(part => format(Number(part) * strokeScale))
          .join(' ')}"`
      : ''
    return `fill="none" stroke="${style.colour}" stroke-width="${format(Math.max(style.width * strokeScale, 0.12))}" stroke-linecap="round" stroke-linejoin="round"${dash}`
  }

  /**
   * Projects a tile-local ring into canvas pixels, simplifies it, and rejects
   * anything too small or entirely off-canvas.
   *
   * The off-canvas test uses a generous margin rather than the exact frame:
   * a long road just outside it can still put a visible stroke inside once the
   * line width is taken into account.
   */
  function place(ring: number[], offsetX: number, offsetY: number, factor: number, closed: boolean): number[] | null {
    const projected: number[] = new Array(ring.length)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (let index = 0; index < ring.length; index += 2) {
      const x = offsetX + ring[index]! * factor
      const y = offsetY + ring[index + 1]! * factor
      projected[index] = x
      projected[index + 1] = y

      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    const margin = 8
    if (maxX < -margin || minX > width + margin || maxY < -margin || minY > height + margin) return null

    const reduced = simplify(projected, SIMPLIFY_TOLERANCE)
    if (reduced.length < (closed ? 6 : 4)) return null
    if (closed ? ringArea(reduced) < MIN_AREA : lineLength(reduced) < MIN_LENGTH) return null

    return reduced
  }

  /**
   * Adds one feature to its bucket.
   *
   * `tileKey` is what keeps filled shapes from cancelling each other out.
   * Fills use the even-odd rule so that polygon holes work without trusting
   * ring winding, but even-odd also means that where two shapes *overlap*
   * inside one path, the overlap becomes a hole. Neighbouring tiles each carry
   * a margin of the other's geometry, so merging every tile's ocean into a
   * single path punches a transparent cross along every seam. Filled styles
   * therefore get one path per tile, which unions correctly because each path
   * is painted opaque and separately. Strokes have no such problem and are
   * merged across the whole view.
   */
  function draw(
    feature: VectorFeature,
    key: string,
    attributes: string,
    offsetX: number,
    offsetY: number,
    factor: number,
    tileKey: string,
    filled: boolean
  ): void {
    const closed = feature.type === GeometryType.Polygon
    if (feature.type === GeometryType.Point) return

    const bucketKey = filled ? `${key}@${tileKey}` : key

    let drew = false
    for (const ring of feature.geometry) {
      const placed = place(ring, offsetX, offsetY, factor, closed)
      if (!placed) continue

      bucketFor(bucketKey, attributes).parts.push(pathData(placed, closed))
      drew = true
    }

    if (drew) featureCount++
  }

  for (const tile of tiles) {
    let layers
    try {
      layers = decodeTile(tile.data, { layers: wantedLayers, keys: WANTED_KEYS })
    } catch {
      // A tile that will not parse costs its own square, not the picture.
      continue
    }

    const tileKey = `${tile.id.x}_${tile.id.y}`

    for (const layer of layers) {
      const factor = scale / layer.extent
      const offsetX = (tile.id.x - bounds.minX) * scale
      const offsetY = (tile.id.y - bounds.minY) * scale

      for (const feature of layer.features) {
        const featureClass = typeof feature.properties.class === 'string' ? feature.properties.class : ''

        switch (layer.name) {
          case 'water':
            if (theme.water)
              draw(feature, 'water', fillAttributes(theme.water), offsetX, offsetY, factor, tileKey, true)
            break

          case 'waterway':
            if (theme.waterway)
              draw(feature, 'waterway', lineAttributes(theme.waterway), offsetX, offsetY, factor, tileKey, false)
            break

          case 'landcover': {
            const group = LANDCOVER_GROUPS[featureClass]
            const style = group ? theme[group] : undefined
            if (style) draw(feature, `land-${group}`, fillAttributes(style), offsetX, offsetY, factor, tileKey, true)
            break
          }

          case 'park':
            if (theme.grass)
              draw(feature, 'land-grass', fillAttributes(theme.grass), offsetX, offsetY, factor, tileKey, true)
            break

          case 'building':
            if (theme.building)
              draw(feature, 'building', fillAttributes(theme.building), offsetX, offsetY, factor, tileKey, true)
            break

          case 'boundary':
            if (theme.boundary)
              draw(feature, 'boundary', lineAttributes(theme.boundary), offsetX, offsetY, factor, tileKey, false)
            break

          case 'transportation': {
            const tier = ROAD_CLASS_TIERS[featureClass]
            const style = tier ? theme.roads[tier] : undefined
            // Road *areas* pedestrian squares, service yards, arrive as
            // polygons in the same layer. Stroking their outline is what the
            // linework style wants; filling them would put slabs of colour
            // across the middle of a town centre.
            if (style) draw(feature, `road-${tier}`, lineAttributes(style), offsetX, offsetY, factor, tileKey, false)
            break
          }

          default:
            break
        }
      }
    }
  }

  const ordered = [...buckets.values()].filter(bucket => bucket.parts.length > 0).sort((a, b) => a.rank - b.rank)

  const paint = (bucket: Bucket): string => `<path ${bucket.attributes} d="${bucket.parts.join('')}"/>`

  // The marker is emitted rather than the hillshade itself: whether a picture
  // gets one depends on how much was drawn, which is only known once it has
  // been. A placeholder means that decision can be made afterwards without
  // rendering the whole thing a second time.
  const body = [
    ...ordered.filter(bucket => bucket.rank < UNDERLAY_AFTER).map(paint),
    UNDERLAY_MARKER,
    ...ordered.filter(bucket => bucket.rank >= UNDERLAY_AFTER).map(paint)
  ].join('\n')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `<title>${escapeAttribute(theme.name)}</title>\n` +
    `<rect width="${width}" height="${height}" fill="${theme.background}"/>\n` +
    `${body}\n</svg>\n`

  return { svg, featureCount }
}
