/**
 * A Mapbox Vector Tile reader, written out rather than pulled in.
 *
 * Decoding an MVT is a protobuf walk over four message types and one
 * zigzag-delta geometry encoding — about two hundred lines, with no
 * dependencies and no native build. The alternative was `@mapbox/vector-tile`
 * plus `pbf`, which is a reasonable library but brings a general protobuf
 * runtime along for a job with exactly one schema, and this project runs on a
 * Raspberry Pi where every dependency is also an `npm install` somebody has to
 * sit through.
 *
 * Two decisions here are about that machine rather than about correctness:
 * layers and property keys are filtered *during* the walk rather than after,
 * so a tile's ten thousand `name:ja` strings are never allocated, and
 * coordinates land in flat number arrays rather than point objects.
 *
 * Format: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

export const enum GeometryType {
  Unknown = 0,
  Point = 1,
  LineString = 2,
  Polygon = 3
}

export type PropertyValue = string | number | boolean

export interface VectorFeature {
  type: GeometryType
  properties: Record<string, PropertyValue>
  /**
   * One entry per ring or line, each a flat `[x0, y0, x1, y1, ...]` in
   * tile-local units. A point feature is a one-coordinate entry. Polygon
   * rings arrive in source order — exterior first, then any holes — which is
   * all the renderer needs, since it fills with the even-odd rule rather than
   * inspecting winding.
   */
  geometry: number[][]
}

export interface VectorLayer {
  name: string
  /** The tile's own coordinate range, almost always 4096. */
  extent: number
  features: VectorFeature[]
}

/** Which layers and property keys the caller intends to use. */
export interface DecodeFilter {
  layers?: ReadonlySet<string>
  keys?: ReadonlySet<string>
}

/** A position in the buffer, threaded through the readers. */
interface Cursor {
  readonly data: Uint8Array
  offset: number
}

function readVarint(cursor: Cursor): number {
  let result = 0
  let shift = 0

  for (;;) {
    if (cursor.offset >= cursor.data.length) throw new Error('Vector tile ended mid-varint')

    const byte = cursor.data[cursor.offset++]!
    // Beyond 2^53 a JavaScript number stops being exact. Nothing this reader
    // uses is that large — the widest real field is a feature id, which is
    // skipped — so saturating is safer than silently returning a wrong value.
    if (shift < 53) result += (byte & 0x7f) * 2 ** shift
    shift += 7

    if ((byte & 0x80) === 0) return result
  }
}

/**
 * Protobuf's signed varint encoding, used for every geometry delta.
 *
 * The bitwise form is 32-bit, which is the right range here: deltas are
 * measured in tile-local units and a tile is 4096 wide, so they are small by
 * construction. A 64-bit `sint` property would overflow this, but the
 * OpenMapTiles schema has none.
 */
function zigzag(value: number): number {
  return (value >>> 1) ^ -(value & 1)
}

/** Skips a field whose value the caller does not want. */
function skip(cursor: Cursor, wireType: number): void {
  switch (wireType) {
    case 0:
      readVarint(cursor)
      return
    case 1:
      cursor.offset += 8
      return
    case 2:
      cursor.offset += readVarint(cursor)
      return
    case 5:
      cursor.offset += 4
      return
    default:
      throw new Error(`Unsupported protobuf wire type ${wireType}`)
  }
}

function readString(cursor: Cursor, length: number): string {
  const text = Buffer.from(cursor.data.buffer, cursor.data.byteOffset + cursor.offset, length).toString('utf8')

  cursor.offset += length
  return text
}

/**
 * Decodes one `Value` message.
 *
 * A Value carries exactly one of seven typed fields. Only the string and
 * numeric forms appear in OpenMapTiles data in practice, but the others cost
 * three lines each and an unknown value would otherwise become `undefined` in
 * a style lookup.
 */
function readValue(cursor: Cursor, end: number): PropertyValue | undefined {
  let value: PropertyValue | undefined

  while (cursor.offset < end) {
    const tag = readVarint(cursor)
    const field = tag >> 3

    switch (field) {
      case 1:
        value = readString(cursor, readVarint(cursor))
        break
      case 2: {
        const view = new DataView(cursor.data.buffer, cursor.data.byteOffset + cursor.offset, 4)
        value = view.getFloat32(0, true)
        cursor.offset += 4
        break
      }
      case 3: {
        const view = new DataView(cursor.data.buffer, cursor.data.byteOffset + cursor.offset, 8)
        value = view.getFloat64(0, true)
        cursor.offset += 8
        break
      }
      case 4:
      case 5:
        value = readVarint(cursor)
        break
      case 6:
        value = zigzag(readVarint(cursor))
        break
      case 7:
        value = readVarint(cursor) !== 0
        break
      default:
        skip(cursor, tag & 0x7)
    }
  }

  return value
}

/**
 * Walks the command/parameter stream into rings.
 *
 * Coordinates are deltas from a running cursor, so this cannot be done
 * lazily or out of order. `ClosePath` is not emitted as a coordinate: the
 * renderer closes rings itself with `Z`, which keeps the path data shorter.
 */
function readGeometry(cursor: Cursor, end: number): number[][] {
  const rings: number[][] = []
  let current: number[] | null = null
  let x = 0
  let y = 0

  while (cursor.offset < end) {
    const command = readVarint(cursor)
    const id = command & 0x7
    const count = command >> 3

    if (id === 1) {
      // MoveTo. Every MoveTo starts a new ring or line; a multipoint feature
      // encodes its points as one MoveTo with a count above one, which is why
      // this loop pushes a ring per point in that case.
      for (let n = 0; n < count; n++) {
        x += zigzag(readVarint(cursor))
        y += zigzag(readVarint(cursor))
        current = [x, y]
        rings.push(current)
      }
    } else if (id === 2) {
      // LineTo, continuing whatever MoveTo opened. A stream that begins with
      // LineTo is malformed; dropping it is better than throwing, since one
      // broken feature should not cost the whole tile.
      if (current === null) {
        for (let n = 0; n < count * 2; n++) readVarint(cursor)
        continue
      }

      for (let n = 0; n < count; n++) {
        x += zigzag(readVarint(cursor))
        y += zigzag(readVarint(cursor))
        current.push(x, y)
      }
    } else if (id === 7) {
      // ClosePath takes no parameters and moves the cursor back to the ring's
      // first point, which matters for the deltas that follow it.
      if (current !== null && current.length >= 2) {
        x = current[0]!
        y = current[1]!
      }
      current = null
    } else {
      throw new Error(`Unknown geometry command ${id}`)
    }
  }

  return rings
}

function readFeature(
  cursor: Cursor,
  end: number,
  keys: string[],
  values: (PropertyValue | undefined)[],
  wantedKeys: ReadonlySet<string> | undefined
): VectorFeature {
  const feature: VectorFeature = { type: GeometryType.Unknown, properties: {}, geometry: [] }

  while (cursor.offset < end) {
    const tag = readVarint(cursor)
    const field = tag >> 3

    switch (field) {
      case 2: {
        // Tags are a packed list of alternating key and value indices.
        const tagsLength = readVarint(cursor)
        const tagsEnd = cursor.offset + tagsLength
        while (cursor.offset < tagsEnd) {
          const key = keys[readVarint(cursor)]
          const value = values[readVarint(cursor)]
          if (key !== undefined && value !== undefined && (!wantedKeys || wantedKeys.has(key))) {
            feature.properties[key] = value
          }
        }
        break
      }
      case 3:
        feature.type = readVarint(cursor) as GeometryType
        break
      case 4: {
        const geometryLength = readVarint(cursor)
        feature.geometry = readGeometry(cursor, cursor.offset + geometryLength)
        break
      }
      default:
        // Field 1 is the feature id, which nothing here uses.
        skip(cursor, tag & 0x7)
    }
  }

  return feature
}

function readLayer(cursor: Cursor, end: number, filter: DecodeFilter): VectorLayer | null {
  // The keys and values dictionaries may appear after the features that refer
  // to them, so features are collected as byte ranges on the first pass and
  // decoded once the dictionaries are complete.
  const keys: string[] = []
  const values: (PropertyValue | undefined)[] = []
  const featureRanges: Array<[number, number]> = []

  let name = ''
  let extent = 4096

  while (cursor.offset < end) {
    const tag = readVarint(cursor)
    const field = tag >> 3

    switch (field) {
      case 1:
        name = readString(cursor, readVarint(cursor))
        // Nothing else in this layer is worth reading if the caller does not
        // want it, and skipping here is what makes decoding a tile cheap.
        if (filter.layers && !filter.layers.has(name)) {
          cursor.offset = end
          return null
        }
        break
      case 2: {
        const length = readVarint(cursor)
        featureRanges.push([cursor.offset, cursor.offset + length])
        cursor.offset += length
        break
      }
      case 3:
        keys.push(readString(cursor, readVarint(cursor)))
        break
      case 4: {
        const length = readVarint(cursor)
        values.push(readValue(cursor, cursor.offset + length))
        break
      }
      case 5:
        extent = readVarint(cursor)
        break
      default:
        skip(cursor, tag & 0x7)
    }
  }

  if (name === '') return null

  const features = featureRanges.map(([start, stop]) =>
    readFeature({ data: cursor.data, offset: start }, stop, keys, values, filter.keys)
  )

  return { name, extent, features }
}

/**
 * Decodes a tile, keeping only what `filter` asks for.
 *
 * A malformed layer is dropped rather than thrown: tiles come off the network,
 * and one bad layer in a twenty-tile view should cost that layer, not the
 * artwork.
 */
export function decodeTile(data: Uint8Array, filter: DecodeFilter = {}): VectorLayer[] {
  const cursor: Cursor = { data, offset: 0 }
  const layers: VectorLayer[] = []

  while (cursor.offset < data.length) {
    const tag = readVarint(cursor)

    if (tag >> 3 !== 3) {
      skip(cursor, tag & 0x7)
      continue
    }

    // Read the length into its own binding first: `cursor.offset + read(...)`
    // would take the offset before the varint was consumed.
    const length = readVarint(cursor)
    const end = cursor.offset + length

    try {
      const layer = readLayer(cursor, end, filter)
      if (layer) layers.push(layer)
    } catch {
      // Fall through to the next layer.
    }

    cursor.offset = end
  }

  return layers
}
