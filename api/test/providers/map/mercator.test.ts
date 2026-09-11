import { describe, expect, it } from 'vitest'
import {
  boundsFor,
  MAX_ZOOM,
  project,
  tilesCovering,
  tileWidthMetres,
  zoomForSpan
} from '../../../lib/providers/map/mercator'

describe('project', () => {
  it('puts the null island at the centre of the world', () => {
    expect(project(0, 0, 1)).toEqual({ x: 1, y: 1 })
  })

  it('places Greenwich on the vertical seam', () => {
    expect(project(51.4934, 0, 8).x).toBe(128)
  })

  it('clamps beyond the Mercator limit rather than returning infinity', () => {
    const pole = project(89.9, 0, 4)

    expect(Number.isFinite(pole.y)).toBe(true)
    expect(pole.y).toBeGreaterThanOrEqual(0)
  })
})

describe('tileWidthMetres', () => {
  it('shrinks with latitude', () => {
    // The same tile covers far less ground over Nanaimo than over Singapore,
    // which is exactly why a zoom cannot be chosen from a distance alone.
    expect(tileWidthMetres(49.16, 13)).toBeLessThan(tileWidthMetres(1.35, 13))
  })

  it('halves with each zoom level', () => {
    expect(tileWidthMetres(49.16, 13) / tileWidthMetres(49.16, 14)).toBeCloseTo(2, 6)
  })
})

describe('zoomForSpan', () => {
  it('picks a closer zoom for a smaller town', () => {
    expect(zoomForSpan(49.15, 3200, 4)).toBeGreaterThan(zoomForSpan(49.28, 13000, 4))
  })

  it('never exceeds what the tile server has', () => {
    expect(zoomForSpan(49.15, 200, 4)).toBe(MAX_ZOOM)
  })
})

describe('boundsFor', () => {
  it('frames the requested span, in the aspect of the output', () => {
    const bounds = boundsFor(49.2827, -123.1207, 11000, 2000, 1250)
    const aspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY)

    expect(aspect).toBeCloseTo(2000 / 1250, 6)
  })

  it('keeps the city at the centre', () => {
    const bounds = boundsFor(51.4816, -3.1791, 8000, 2000, 1250)
    const centre = project(51.4816, -3.1791, bounds.zoom)

    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(centre.x, 6)
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(centre.y, 6)
  })

  it('steps the zoom down rather than blowing the tile budget', () => {
    // Paris at its natural span rounds up to a zoom that wants thirty tiles
    // and eighteen megabytes. The budget is the only thing standing between
    // a wall display and that bill, every three hours.
    const generous = boundsFor(48.8566, 2.3522, 9000, 2000, 1250, { maxTiles: 100 })
    const budgeted = boundsFor(48.8566, 2.3522, 9000, 2000, 1250, { maxTiles: 20 })

    expect(tilesCovering(generous).length).toBeGreaterThan(20)
    expect(tilesCovering(budgeted).length).toBeLessThanOrEqual(20)
    expect(budgeted.zoom).toBeLessThan(generous.zoom)
  })

  it('covers the same ground whichever zoom the budget settles on', () => {
    const budgeted = boundsFor(48.8566, 2.3522, 9000, 2000, 1250, { maxTiles: 20 })
    const width = (budgeted.maxX - budgeted.minX) * tileWidthMetres(48.8566, budgeted.zoom)

    expect(width).toBeCloseTo(9000, 0)
  })
})

describe('tilesCovering', () => {
  it('lists every tile the view touches', () => {
    const tiles = tilesCovering({ zoom: 4, minX: 1.2, minY: 2.7, maxX: 3.1, maxY: 3.4 })

    expect(tiles).toHaveLength(6)
    expect(tiles.every(tile => tile.zoom === 4)).toBe(true)
  })

  it('wraps around the antimeridian instead of asking for a negative tile', () => {
    const tiles = tilesCovering({ zoom: 2, minX: -0.5, minY: 1.2, maxX: 0.5, maxY: 1.4 })

    expect(tiles.map(tile => tile.x).sort()).toEqual([0, 3])
  })

  it('drops rows above the pole, which have no tiles at all', () => {
    const tiles = tilesCovering({ zoom: 2, minX: 1.1, minY: -1.5, maxX: 1.4, maxY: 0.5 })

    expect(tiles.every(tile => tile.y >= 0)).toBe(true)
    expect(tiles).toHaveLength(1)
  })
})
