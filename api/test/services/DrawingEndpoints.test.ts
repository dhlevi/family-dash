import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/core/model/ApiError'

/**
 * The drawing page can hand the API an unbounded amount of ink — a stuck
 * pointer, a wedged stylus, or simply a very long session. These tests cover
 * the boundary that stops that from filling the Pi's SD card, and the two
 * cases where an accidental save would lose or clutter someone's work.
 *
 * The repository is stubbed because none of this needs a database: what is
 * under test is what the endpoint accepts before it ever gets that far.
 */
const create = vi.fn(async (drawing: unknown) => ({ id: 'drawing-1', ...(drawing as object) }))
const update = vi.fn(async (_id: string, patch: unknown) => ({ id: 'drawing-1', ...(patch as object) }))

vi.mock('../../lib/repositories/DrawingRepository', () => ({
  DrawingRepository: class {
    public create = create
    public update = update
  }
}))

const { DrawingEndpoints } = await import('../../lib/services/DrawingEndpoints')

const endpoints = new DrawingEndpoints()

/** A stroke of `points` samples, spaced a pixel apart. */
function stroke(points: number) {
  return {
    colour: '#111111',
    width: 4,
    points: Array.from({ length: points }, (_, index) => ({ x: index, y: index, p: 0.5 }))
  }
}

const drawing = (strokes: ReturnType<typeof stroke>[]) => ({ strokes, width: 1200, height: 800 })

beforeEach(() => {
  create.mockClear()
  update.mockClear()
})

describe('DrawingEndpoints.create', () => {
  it('accepts a drawing and defaults the pressure of a point that has none', async () => {
    await endpoints.create({
      title: '  Fish  ',
      strokes: [{ colour: '#ff0000', width: 4, points: [{ x: 1, y: 2 }] }],
      width: 640,
      height: 480
    })

    const [saved] = create.mock.calls[0] as [{ title: string; strokes: { points: { p: number }[] }[] }]
    expect(saved.title).toBe('Fish')
    expect(saved.strokes[0]!.points[0]!.p).toBe(0.5)
  })

  it('refuses an untouched canvas rather than filling the gallery with blanks', async () => {
    await expect(endpoints.create(drawing([]))).rejects.toMatchObject({ statusCode: 422 })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a stroke with no points at all', async () => {
    await expect(endpoints.create(drawing([stroke(0)]))).rejects.toThrow()
  })

  it('rejects a colour that is not a hex triplet', async () => {
    const body = { ...drawing([stroke(2)]), background: 'red' }
    await expect(endpoints.create(body)).rejects.toThrow()
  })

  it('takes a drawing right at the point cap', async () => {
    // 15 strokes of 4000 points is 60000 — the total limit exactly, and each
    // stroke is at its own per-stroke limit too.
    await endpoints.create(drawing(Array.from({ length: 15 }, () => stroke(4000))))
    expect(create).toHaveBeenCalledOnce()
  })

  it('refuses one point beyond the cap', async () => {
    const strokes = [...Array.from({ length: 15 }, () => stroke(4000)), stroke(1)]
    await expect(endpoints.create(drawing(strokes))).rejects.toThrow(/60000 ink points/)
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses a single stroke longer than the per-stroke cap', async () => {
    await expect(endpoints.create(drawing([stroke(4001)]))).rejects.toThrow()
  })

  it('refuses more strokes than the cap, however short they are', async () => {
    const strokes = Array.from({ length: 1501 }, () => stroke(1))
    await expect(endpoints.create(drawing(strokes))).rejects.toThrow()
  })
})

describe('DrawingEndpoints.update', () => {
  it('saves new ink over an existing drawing', async () => {
    await endpoints.update('drawing-1', { strokes: [stroke(3)] })
    expect(update).toHaveBeenCalledOnce()
  })

  it('will not empty a saved drawing, and says what to do instead', async () => {
    // A cleared canvas reaching the API is far more likely to be a mis-tap
    // than an intention to throw the drawing away.
    await expect(endpoints.update('drawing-1', { strokes: [] })).rejects.toThrow(/Delete it instead/)
    expect(update).not.toHaveBeenCalled()
  })

  it('leaves ink untouched when the patch only renames', async () => {
    await endpoints.update('drawing-1', { title: 'Rocket' })

    const [, patch] = update.mock.calls[0] as [string, { title: string; strokes?: unknown }]
    expect(patch.title).toBe('Rocket')
    expect(patch.strokes).toBeUndefined()
  })

  it('reports a missing drawing as a 404', async () => {
    update.mockResolvedValueOnce(null as never)

    await expect(endpoints.update('nope', { title: 'Rocket' })).rejects.toMatchObject({
      statusCode: 404,
      code: ApiError.notFound().code
    })
  })
})
