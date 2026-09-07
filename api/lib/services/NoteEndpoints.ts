import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { NoteRepository } from '../repositories/NoteRepository'
import type { StickyNote } from '../types/domain'

const notes = new NoteRepository()

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour')

/**
 * Limits on a handwritten note.
 *
 * Generous enough that nobody writing on a sticky note will meet them, small
 * enough that a stuck pointer-move loop or a pasted payload cannot fill the
 * Pi's SD card. A note at the cap is roughly 600KB of JSON.
 */
const MAX_STROKES = 500
const MAX_POINTS_PER_STROKE = 2000
const MAX_POINTS_TOTAL = 20000

const inkPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  // Stylus pressure. A finger or mouse reports 0.5.
  p: z.number().min(0).max(1).default(0.5)
})

const inkStrokeSchema = z.object({
  colour: hexColour,
  width: z.number().min(0.5).max(64),
  points: z.array(inkPointSchema).min(1).max(MAX_POINTS_PER_STROKE)
})

const strokesSchema = z
  .array(inkStrokeSchema)
  .max(MAX_STROKES)
  .refine(
    strokes => strokes.reduce((total, stroke) => total + stroke.points.length, 0) <= MAX_POINTS_TOTAL,
    `A note cannot hold more than ${MAX_POINTS_TOTAL} ink points`
  )

/** Positions are fractions of the board, so they survive a screen rotation. */
const fraction = z.number().min(0).max(1)

const newNoteSchema = z
  .object({
    kind: z.enum(['text', 'ink']).default('text'),
    body: z.string().max(4000).optional(),
    colour: hexColour.optional(),
    x: fraction.optional(),
    y: fraction.optional(),
    pinned: z.boolean().optional(),
    strokes: strokesSchema.optional(),
    inkWidth: z.number().int().positive().max(8000).optional(),
    inkHeight: z.number().int().positive().max(8000).optional()
  })
  .refine(note => note.kind !== 'ink' || (note.inkWidth !== undefined && note.inkHeight !== undefined), {
    message: 'A handwritten note must include the size of the surface it was drawn on',
    path: ['inkWidth']
  })

const noteUpdateSchema = z.object({
  body: z.string().max(4000).optional(),
  colour: hexColour.optional(),
  x: fraction.optional(),
  y: fraction.optional(),
  pinned: z.boolean().optional(),
  strokes: strokesSchema.optional(),
  inkWidth: z.number().int().positive().max(8000).optional(),
  inkHeight: z.number().int().positive().max(8000).optional()
})

export class NoteEndpoints {
  public async list(pinnedOnly?: boolean, limit?: number): Promise<StickyNote[]> {
    if (pinnedOnly === true) return notes.pinned(Math.min(Math.max(limit ?? 8, 1), 50))

    return notes.all()
  }

  public async byId(id: string): Promise<StickyNote> {
    const note = await notes.byId(id)
    if (!note) throw ApiError.notFound(`No note with id '${id}'`)
    return note
  }

  public async create(body: unknown): Promise<StickyNote> {
    const parsed = newNoteSchema.parse(body)

    // A typed note with no words and no drawing would be an invisible card
    // on the board that nobody can find again.
    if (parsed.kind === 'text' && (parsed.body ?? '').trim().length === 0) {
      throw ApiError.unprocessable('A typed note needs some text', { field: 'body' })
    }
    if (parsed.kind === 'ink' && (parsed.strokes ?? []).length === 0) {
      throw ApiError.unprocessable('A handwritten note needs at least one stroke', { field: 'strokes' })
    }

    return notes.create({
      kind: parsed.kind,
      body: parsed.body?.trim() ?? '',
      colour: parsed.colour,
      x: parsed.x,
      y: parsed.y,
      pinned: parsed.pinned,
      strokes: parsed.strokes,
      inkWidth: parsed.inkWidth ?? null,
      inkHeight: parsed.inkHeight ?? null
    })
  }

  public async update(id: string, body: unknown): Promise<StickyNote> {
    const parsed = noteUpdateSchema.parse(body)
    const existing = await notes.byId(id)
    if (!existing) throw ApiError.notFound(`No note with id '${id}'`)

    // A note cannot change medium: the strokes and the text mean different
    // things, and silently discarding one to accept the other loses work.
    if (parsed.strokes !== undefined && existing.kind !== 'ink') {
      throw ApiError.conflict('That note is a typed note; it cannot be given handwriting')
    }
    if (parsed.strokes !== undefined && parsed.strokes.length === 0) {
      throw ApiError.unprocessable('A handwritten note needs at least one stroke', { field: 'strokes' })
    }
    if (existing.kind === 'text' && parsed.body !== undefined && parsed.body.trim().length === 0) {
      throw ApiError.unprocessable('A typed note needs some text', { field: 'body' })
    }

    const updated = await notes.update(id, {
      body: parsed.body === undefined ? undefined : parsed.body.trim(),
      colour: parsed.colour,
      x: parsed.x,
      y: parsed.y,
      pinned: parsed.pinned,
      strokes: parsed.strokes,
      inkWidth: parsed.inkWidth,
      inkHeight: parsed.inkHeight
    })

    if (!updated) throw ApiError.notFound(`No note with id '${id}'`)
    return updated
  }

  /** Raise a note above the rest of the pile. */
  public async bringToFront(id: string): Promise<StickyNote> {
    const raised = await notes.bringToFront(id)
    if (!raised) throw ApiError.notFound(`No note with id '${id}'`)
    return raised
  }

  public async remove(id: string): Promise<void> {
    if (!(await notes.remove(id))) throw ApiError.notFound(`No note with id '${id}'`)
  }

  public async counts(): Promise<{ total: number; pinned: number }> {
    return notes.counts()
  }
}
