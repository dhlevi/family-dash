import { describe, expect, it } from 'vitest'
import { renderMapArt, type FetchedTile } from '../../../lib/providers/map/MapArtRenderer'
import { themeById, type MapTheme } from '../../../lib/providers/map/themes'
import type { TileBounds } from '../../../lib/providers/map/mercator'

/**
 * The renderer is driven with hand-built tiles, so that each test states one
 * geometric fact rather than depending on what OpenStreetMap happens to hold
 * over a particular city this week.
 */

function varint(value: number): number[] {
  const bytes: number[] = []
  let remaining = value

  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining > 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining > 0)

  return bytes
}

const zigzag = (value: number): number => (value << 1) ^ (value >> 31)
const tag = (field: number, wire: number): number[] => varint((field << 3) | wire)
const lengthDelimited = (field: number, payload: number[]): number[] => [
  ...tag(field, 2),
  ...varint(payload.length),
  ...payload
]
const string = (field: number, text: string): number[] => lengthDelimited(field, [...Buffer.from(text, 'utf8')])

/** A closed square of `size` tile units, with its corner at (x, y). */
function square(x: number, y: number, size: number): number[] {
  return [
    1 | (1 << 3),
    zigzag(x),
    zigzag(y),
    2 | (3 << 3),
    zigzag(size),
    zigzag(0),
    zigzag(0),
    zigzag(size),
    zigzag(-size),
    zigzag(0),
    7 | (1 << 3)
  ]
}

/** A horizontal line of `length` tile units, starting at (x, y). */
function horizontal(x: number, y: number, length: number): number[] {
  return [1 | (1 << 3), zigzag(x), zigzag(y), 2 | (1 << 3), zigzag(length), zigzag(0)]
}

function tile(layers: Array<{ name: string; type: number; geometry: number[]; roadClass?: string }>): Uint8Array {
  const bytes: number[] = []

  for (const entry of layers) {
    const hasClass = entry.roadClass !== undefined
    bytes.push(
      ...lengthDelimited(3, [
        ...tag(15, 0),
        ...varint(2),
        ...string(1, entry.name),
        ...lengthDelimited(2, [
          ...lengthDelimited(2, hasClass ? [...varint(0), ...varint(0)] : []),
          ...tag(3, 0),
          ...varint(entry.type),
          ...lengthDelimited(4, entry.geometry.flatMap(varint))
        ]),
        ...(hasClass ? string(3, 'class') : []),
        ...(hasClass ? lengthDelimited(4, string(1, entry.roadClass!)) : []),
        ...tag(5, 0),
        ...varint(4096)
      ])
    )
  }

  return Uint8Array.from(bytes)
}

const theme = themeById('blueprint')!

/** A two-tile view, 1000x500, so each tile is 500 output pixels across. */
const bounds: TileBounds = { zoom: 12, minX: 100, minY: 200, maxX: 102, maxY: 201 }
const SIZE = { width: 1000, height: 500 }

const paths = (svg: string): string[] => svg.match(/<path [^>]*\/>/g) ?? []

describe('renderMapArt', () => {
  it('draws the background even with no tiles at all', () => {
    const { svg, featureCount } = renderMapArt([], bounds, { theme, ...SIZE })

    expect(svg).toContain(`<rect width="1000" height="500" fill="${theme.background}"/>`)
    expect(featureCount).toBe(0)
    expect(paths(svg)).toHaveLength(0)
  })

  it('places a tile-local coordinate at the right point on the canvas', () => {
    // Tile 100 is the left half of the view, so the centre of that tile is a
    // quarter of the way across a 1000px canvas.
    const tiles: FetchedTile[] = [
      { id: { zoom: 12, x: 100, y: 200 }, data: tile([{ name: 'water', type: 3, geometry: square(2048, 2048, 512) }]) }
    ]

    const { svg } = renderMapArt(tiles, bounds, { theme, ...SIZE })

    expect(paths(svg)[0]).toContain('M250 250')
  })

  it('merges strokes of one road tier into a single path across tiles', () => {
    const road = { name: 'transportation', type: 2, geometry: horizontal(0, 2048, 4096), roadClass: 'primary' }
    const tiles: FetchedTile[] = [
      { id: { zoom: 12, x: 100, y: 200 }, data: tile([road]) },
      { id: { zoom: 12, x: 101, y: 200 }, data: tile([road]) }
    ]

    const { svg, featureCount } = renderMapArt(tiles, bounds, { theme, ...SIZE })

    expect(featureCount).toBe(2)
    expect(paths(svg)).toHaveLength(1)
    expect(paths(svg)[0]).toContain('fill="none"')
  })

  it("keeps each tile's fills in their own path", () => {
    // Vector tiles carry a margin of their neighbours' geometry, so the same
    // water appears in both. Merged into one even-odd path the overlap would
    // cancel to a transparent stripe down every seam — which is exactly what
    // it did, visibly, before fills were split per tile.
    const water = { name: 'water', type: 3, geometry: square(0, 0, 4096) }
    const tiles: FetchedTile[] = [
      { id: { zoom: 12, x: 100, y: 200 }, data: tile([water]) },
      { id: { zoom: 12, x: 101, y: 200 }, data: tile([water]) }
    ]

    const { svg } = renderMapArt(tiles, bounds, { theme, ...SIZE })
    const filled = paths(svg).filter(path => path.includes('fill-rule="evenodd"'))

    expect(filled).toHaveLength(2)
  })

  it('paints water beneath roads', () => {
    const tiles: FetchedTile[] = [
      {
        id: { zoom: 12, x: 100, y: 200 },
        data: tile([
          { name: 'transportation', type: 2, geometry: horizontal(0, 2048, 4096), roadClass: 'motorway' },
          { name: 'water', type: 3, geometry: square(0, 0, 4096) }
        ])
      }
    ]

    const { svg } = renderMapArt(tiles, bounds, { theme, ...SIZE })
    const rendered = paths(svg)

    expect(rendered[0]).toContain('fill-rule="evenodd"')
    expect(rendered[1]).toContain(`stroke="${theme.roads.motorway!.colour}"`)
  })

  it('scales stroke widths with the canvas, so both orientations match', () => {
    const road = { name: 'transportation', type: 2, geometry: horizontal(0, 2048, 4096), roadClass: 'motorway' }
    const tiles: FetchedTile[] = [{ id: { zoom: 12, x: 100, y: 200 }, data: tile([road]) }]

    const wide = renderMapArt(tiles, bounds, { theme, width: 2000, height: 1000 })
    const narrow = renderMapArt(tiles, bounds, { theme, width: 1000, height: 500 })

    expect(paths(wide.svg)[0]).toContain('stroke-width="4.1"')
    expect(paths(narrow.svg)[0]).toContain('stroke-width="2.1"')
  })

  it('ignores layers the theme has no style for', () => {
    // `building` is off in this theme, and a theme that does not ask for a
    // layer should not pay to decode it either.
    const tiles: FetchedTile[] = [
      {
        id: { zoom: 12, x: 100, y: 200 },
        data: tile([{ name: 'building', type: 3, geometry: square(100, 100, 900) }])
      }
    ]

    const { svg, featureCount } = renderMapArt(tiles, bounds, { theme, ...SIZE })

    expect(featureCount).toBe(0)
    expect(paths(svg)).toHaveLength(0)
  })

  it('discards geometry that falls outside the frame', () => {
    const tiles: FetchedTile[] = [
      // Tile 110 is well east of a view that ends at 102.
      { id: { zoom: 12, x: 110, y: 200 }, data: tile([{ name: 'water', type: 3, geometry: square(0, 0, 4096) }]) }
    ]

    expect(renderMapArt(tiles, bounds, { theme, ...SIZE }).featureCount).toBe(0)
  })

  it('survives a tile that will not parse, and still draws the rest', () => {
    const tiles: FetchedTile[] = [
      { id: { zoom: 12, x: 100, y: 200 }, data: Uint8Array.from([0xff, 0xff, 0xff, 0xff]) },
      {
        id: { zoom: 12, x: 101, y: 200 },
        data: tile([{ name: 'water', type: 3, geometry: square(0, 0, 4096) }])
      }
    ]

    const { featureCount } = renderMapArt(tiles, bounds, { theme, ...SIZE })

    expect(featureCount).toBe(1)
  })

  it('escapes the theme name rather than letting it close the title tag', () => {
    const hostile: MapTheme = { ...theme, name: 'Ink </title><script>alert(1)</script>' }

    expect(renderMapArt([], bounds, { theme: hostile, ...SIZE }).svg).not.toContain('<script>')
  })
})
