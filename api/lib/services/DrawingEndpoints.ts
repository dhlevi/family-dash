import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { DrawingRepository } from '../repositories/DrawingRepository'
import type { Drawing } from '../types/domain'

const drawings = new DrawingRepository()

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour')

/**
 * Limits on a drawing.
 *
 * Larger than a sticky note's, because this is a whole page rather than a
 * card, but still bounded, so a stuck pointer loop or a pasted payload
 * cannot fill the Pi's SD card. A drawing at the cap is roughly 1.7MB of
 * JSON.
 */
const MAX_STROKES = 1500
const MAX_POINTS_PER_STROKE = 4000
const MAX_POINTS_TOTAL = 60000

const inkPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  p: z.number().min(0).max(1).default(0.5)
})

const inkStrokeSchema = z.object({
  colour: hexColour,
  width: z.number().min(0.5).max(96),
  points: z.array(inkPointSchema).min(1).max(MAX_POINTS_PER_STROKE)
})

const strokesSchema = z
  .array(inkStrokeSchema)
  .max(MAX_STROKES)
  .refine(
    strokes => strokes.reduce((total, stroke) => total + stroke.points.length, 0) <= MAX_POINTS_TOTAL,
    `A drawing cannot hold more than ${MAX_POINTS_TOTAL} ink points`
  )

const newDrawingSchema = z.object({
  title: z.string().trim().max(120).optional(),
  strokes: strokesSchema,
  background: hexColour.optional(),
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000)
})

const drawingUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  strokes: strokesSchema.optional(),
  background: hexColour.optional(),
  width: z.number().int().positive().max(8000).optional(),
  height: z.number().int().positive().max(8000).optional()
})

export class DrawingEndpoints {
  public async list(limit?: number): Promise<Drawing[]> {
    return drawings.list(limit)
  }

  public async byId(id: string): Promise<Drawing> {
    const drawing = await drawings.byId(id)
    if (!drawing) throw ApiError.notFound(`No drawing with id '${id}'`)
    return drawing
  }

  public async create(body: unknown): Promise<Drawing> {
    const parsed = newDrawingSchema.parse(body)

    // Saving an untouched canvas would fill the gallery with blank cards.
    if (parsed.strokes.length === 0) {
      throw ApiError.unprocessable('Draw something before saving', { field: 'strokes' })
    }

    return drawings.create(parsed)
  }

  public async update(id: string, body: unknown): Promise<Drawing> {
    const parsed = drawingUpdateSchema.parse(body)

    if (parsed.strokes !== undefined && parsed.strokes.length === 0) {
      // Clearing a saved drawing to nothing is almost certainly a mistake;
      // deleting it is the deliberate action.
      throw ApiError.unprocessable('A drawing cannot be emptied. Delete it instead, or undo the clear.', {
        field: 'strokes'
      })
    }

    const updated = await drawings.update(id, parsed)
    if (!updated) throw ApiError.notFound(`No drawing with id '${id}'`)

    return updated
  }

  public async remove(id: string): Promise<void> {
    if (!(await drawings.remove(id))) throw ApiError.notFound(`No drawing with id '${id}'`)
  }

  public async count(): Promise<{ total: number }> {
    return { total: await drawings.count() }
  }
}
