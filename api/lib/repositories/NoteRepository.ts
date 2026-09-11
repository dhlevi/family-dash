import { PostgresDatabase } from '../db/PostgresDatabase'
import type { InkStroke, NoteKind, StickyNote } from '../types/domain'
import { buildUpdate, toIsoRequired } from './rows'

interface NoteRow {
  id: string
  kind: NoteKind
  body: string
  colour: string
  x: number
  y: number
  z_index: number
  pinned: boolean
  strokes: InkStroke[]
  ink_width: number | null
  ink_height: number | null
  created_at: Date
  updated_at: Date
}

export interface NewNote {
  kind: NoteKind
  body?: string
  colour?: string
  x?: number
  y?: number
  pinned?: boolean
  strokes?: InkStroke[]
  inkWidth?: number | null
  inkHeight?: number | null
}

export interface NoteUpdate {
  body?: string
  colour?: string
  x?: number
  y?: number
  pinned?: boolean
  strokes?: InkStroke[]
  inkWidth?: number | null
  inkHeight?: number | null
}

const COLUMNS = 'id, kind, body, colour, x, y, z_index, pinned, strokes, ink_width, ink_height, created_at, updated_at'

export class NoteRepository {
  /**
   * Every note, in stacking order.
   *
   * `z_index` decides what sits on top when notes overlap on the corkboard;
   * `created_at` breaks ties so the order is stable rather than arbitrary.
   */
  public async all(): Promise<StickyNote[]> {
    const rows = await PostgresDatabase.many<NoteRow>(`SELECT ${COLUMNS} FROM note ORDER BY z_index, created_at`)
    return rows.map(NoteRepository.toDomain)
  }

  /** Pinned notes, newest first.. */
  public async pinned(limit: number): Promise<StickyNote[]> {
    const rows = await PostgresDatabase.many<NoteRow>(
      `SELECT ${COLUMNS} FROM note WHERE pinned ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    )
    return rows.map(NoteRepository.toDomain)
  }

  public async byId(id: string): Promise<StickyNote | null> {
    const row = await PostgresDatabase.one<NoteRow>(`SELECT ${COLUMNS} FROM note WHERE id = $1`, [id])
    return row ? NoteRepository.toDomain(row) : null
  }

  public async create(note: NewNote): Promise<StickyNote> {
    const row = await PostgresDatabase.one<NoteRow>(
      `INSERT INTO note (kind, body, colour, x, y, z_index, pinned, strokes, ink_width, ink_height)
       VALUES ($1, $2, $3, $4, $5,
               -- A new note goes on top of the pile.
               coalesce((SELECT max(z_index) + 1 FROM note), 0),
               $6, $7::jsonb, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        note.kind,
        note.body ?? '',
        note.colour ?? '#ffe066',
        note.x ?? 0.1,
        note.y ?? 0.1,
        note.pinned ?? false,
        JSON.stringify(note.strokes ?? []),
        note.inkWidth ?? null,
        note.inkHeight ?? null
      ]
    )
    return NoteRepository.toDomain(row as NoteRow)
  }

  public async update(id: string, changes: NoteUpdate): Promise<StickyNote | null> {
    const { clause, params } = buildUpdate(
      {
        body: changes.body,
        colour: changes.colour,
        x: changes.x,
        y: changes.y,
        pinned: changes.pinned,
        strokes: changes.strokes === undefined ? undefined : JSON.stringify(changes.strokes),
        ink_width: changes.inkWidth,
        ink_height: changes.inkHeight
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<NoteRow>(
      `UPDATE note SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? NoteRepository.toDomain(row) : null
  }

  /**
   * Raise a note above the others.
   *
   * Done in SQL against the current maximum rather than by sending a
   * client-computed z-index, so two people dragging notes on the same board
   * cannot both claim the same layer.
   */
  public async bringToFront(id: string): Promise<StickyNote | null> {
    const row = await PostgresDatabase.one<NoteRow>(
      `UPDATE note
       SET z_index = coalesce((SELECT max(z_index) + 1 FROM note WHERE id <> $1), 0)
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id]
    )
    return row ? NoteRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM note WHERE id = $1', [id])) > 0
  }

  public async counts(): Promise<{ total: number; pinned: number }> {
    const row = await PostgresDatabase.one<{ total: string; pinned: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE pinned)::text AS pinned FROM note`
    )
    return { total: Number(row?.total ?? 0), pinned: Number(row?.pinned ?? 0) }
  }

  private static toDomain(row: NoteRow): StickyNote {
    return {
      id: row.id,
      kind: row.kind,
      body: row.body,
      colour: row.colour,
      // `double precision` comes back as a number, but guard anyway: a
      // corrupt value would place the note off the board entirely.
      x: Number(row.x),
      y: Number(row.y),
      zIndex: row.z_index,
      pinned: row.pinned,
      strokes: Array.isArray(row.strokes) ? row.strokes : [],
      inkWidth: row.ink_width,
      inkHeight: row.ink_height,
      createdAt: toIsoRequired(row.created_at),
      updatedAt: toIsoRequired(row.updated_at)
    }
  }
}
