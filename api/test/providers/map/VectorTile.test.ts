import { describe, expect, it } from 'vitest'
import { decodeTile, GeometryType } from '../../../lib/providers/map/VectorTile'

/**
 * The decoder is tested against tiles built here rather than against a fixture,
 * because the interesting cases are the ones a real tile rarely contains in
 * isolation: a polygon with a hole, a multipoint, a ClosePath that resets the
 * cursor, and a length-delimited field whose own varint is more than one byte.
 *
 * The encoder below is the minimum needed to express those — it is not a
 * general protobuf writer and is not used anywhere but here.
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

/** A Value message holding a string. */
const stringValue = (text: string): number[] => lengthDelimited(4, string(1, text))

interface TestFeature {
  type: GeometryType
  tags: number[]
  geometry: number[]
}

function feature(input: TestFeature): number[] {
  return lengthDelimited(2, [
    ...lengthDelimited(2, input.tags.flatMap(varint)),
    ...tag(3, 0),
    ...varint(input.type),
    ...lengthDelimited(4, input.geometry.flatMap(varint))
  ])
}

function layer(name: string, keys: string[], values: string[], features: number[][], extent = 4096): number[] {
  return lengthDelimited(3, [
    ...tag(15, 0),
    ...varint(2),
    ...string(1, name),
    ...features.flat(),
    ...keys.flatMap(key => string(3, key)),
    ...values.flatMap(stringValue),
    ...tag(5, 0),
    ...varint(extent)
  ])
}

const moveTo = (count: number): number => 1 | (count << 3)
const lineTo = (count: number): number => 2 | (count << 3)
const closePath = 7 | (1 << 3)

describe('decodeTile', () => {
  it('reads a line feature with its properties', () => {
    const line = feature({
      type: GeometryType.LineString,
      tags: [0, 0],
      geometry: [moveTo(1), zigzag(10), zigzag(20), lineTo(2), zigzag(30), zigzag(0), zigzag(0), zigzag(40)]
    })

    const [decoded] = decodeTile(Uint8Array.from(layer('transportation', ['class'], ['primary'], [line])))

    expect(decoded?.name).toBe('transportation')
    expect(decoded?.extent).toBe(4096)
    expect(decoded?.features).toHaveLength(1)
    expect(decoded?.features[0]?.properties).toEqual({ class: 'primary' })
    // Coordinates are deltas from a running cursor, not absolutes.
    expect(decoded?.features[0]?.geometry).toEqual([[10, 20, 40, 20, 40, 60]])
  })

  it('reads a polygon with a hole as two rings', () => {
    const polygon = feature({
      type: GeometryType.Polygon,
      tags: [],
      geometry: [
        moveTo(1),
        zigzag(0),
        zigzag(0),
        lineTo(2),
        zigzag(100),
        zigzag(0),
        zigzag(0),
        zigzag(100),
        closePath,
        // ClosePath returns the cursor to the ring's first point, so this
        // hole's opening delta is measured from (0, 0) and not from (100, 100).
        moveTo(1),
        zigzag(20),
        zigzag(20),
        lineTo(2),
        zigzag(30),
        zigzag(0),
        zigzag(0),
        zigzag(30),
        closePath
      ]
    })

    const [decoded] = decodeTile(Uint8Array.from(layer('water', [], [], [polygon])))

    expect(decoded?.features[0]?.geometry).toEqual([
      [0, 0, 100, 0, 100, 100],
      [20, 20, 50, 20, 50, 50]
    ])
  })

  it('reads a multipoint as one ring per point', () => {
    const points = feature({
      type: GeometryType.Point,
      tags: [],
      geometry: [moveTo(2), zigzag(5), zigzag(5), zigzag(10), zigzag(10)]
    })

    const [decoded] = decodeTile(Uint8Array.from(layer('place', [], [], [points])))

    expect(decoded?.features[0]?.geometry).toEqual([
      [5, 5],
      [15, 15]
    ])
  })

  it('skips layers the caller did not ask for', () => {
    const one = layer('transportation', [], [], [])
    const two = layer('building', [], [], [])

    const decoded = decodeTile(Uint8Array.from([...one, ...two]), { layers: new Set(['building']) })

    expect(decoded.map(entry => entry.name)).toEqual(['building'])
  })

  it('skips property keys the caller did not ask for', () => {
    const road = feature({
      type: GeometryType.LineString,
      tags: [0, 0, 1, 1],
      geometry: [moveTo(1), zigzag(1), zigzag(1)]
    })

    const [decoded] = decodeTile(
      Uint8Array.from(layer('transportation', ['class', 'name'], ['primary', 'Main Street'], [road])),
      { keys: new Set(['class']) }
    )

    expect(decoded?.features[0]?.properties).toEqual({ class: 'primary' })
  })

  it('reads a layer whose length needs a multi-byte varint', () => {
    // Anything over 127 bytes encodes its length in two bytes, which is where
    // an off-by-the-varint's-own-width bug in the reader would show up: every
    // subsequent layer would start in the wrong place.
    const many = Array.from({ length: 60 }, (_, index) =>
      feature({
        type: GeometryType.LineString,
        tags: [],
        geometry: [moveTo(1), zigzag(index), zigzag(index), lineTo(1), zigzag(1), zigzag(1)]
      })
    )

    const bytes = Uint8Array.from([...layer('transportation', [], [], many), ...layer('water', [], [], [])])
    const decoded = decodeTile(bytes)

    expect(decoded.map(entry => entry.name)).toEqual(['transportation', 'water'])
    expect(decoded[0]?.features).toHaveLength(60)
  })

  it('returns nothing for an empty tile rather than throwing', () => {
    expect(decodeTile(new Uint8Array())).toEqual([])
  })
})
