import { PostgresDatabase } from '../db/PostgresDatabase'
import type { Drawing, InkStroke } from '../types/domain'
import { buildUpdate, toIsoRequired } from './rows'

interface DrawingRow {
  id: string
  title: string
  strokes: InkStroke[]
  background: string
  width: number
  height: number
  created_at: Date
  updated_at: Date
}

export interface NewDrawing {
  title?: string
  strokes: InkStroke[]
  background?: string
  width: number
  height: number
}

export interface DrawingUpdate {
  title?: string
  strokes?: InkStroke[]
  background?: string
  width?: number
  height?: number
}

/**
 * `thumb_path` exists in the schema but is deliberately unused: a drawing is
 * a list of vector strokes, so the gallery renders its own thumbnails as SVG
 * straight from the strokes. Generating and storing PNGs would add a file to
 * keep in step with every edit, for a picture the browser can already draw
 * at any size.
 */
const COLUMNS = 'id, title, strokes, background, width, height, created_at, updated_at'

export class DrawingRepository {
  /** Most recently worked on first — the gallery's natural order. */
  public async list(limit = 60): Promise<Drawing[]> {
    const rows = await PostgresDatabase.many<DrawingRow>(
      `SELECT ${COLUMNS} FROM drawing ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 200)]
    )
    return rows.map(DrawingRepository.toDomain)
  }

  public async byId(id: string): Promise<Drawing | null> {
    const row = await PostgresDatabase.one<DrawingRow>(`SELECT ${COLUMNS} FROM drawing WHERE id = $1`, [id])
    return row ? DrawingRepository.toDomain(row) : null
  }

  public async create(drawing: NewDrawing): Promise<Drawing> {
    const row = await PostgresDatabase.one<DrawingRow>(
      `INSERT INTO drawing (title, strokes, background, width, height)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [
        drawing.title?.trim() || 'Untitled',
        JSON.stringify(drawing.strokes),
        drawing.background ?? '#ffffff',
        drawing.width,
        drawing.height
      ]
    )
    return DrawingRepository.toDomain(row as DrawingRow)
  }

  public async update(id: string, changes: DrawingUpdate): Promise<Drawing | null> {
    const { clause, params } = buildUpdate(
      {
        title: changes.title,
        strokes: changes.strokes === undefined ? undefined : JSON.stringify(changes.strokes),
        background: changes.background,
        width: changes.width,
        height: changes.height
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<DrawingRow>(
      `UPDATE drawing SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? DrawingRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM drawing WHERE id = $1', [id])) > 0
  }

  public async count(): Promise<number> {
    const row = await PostgresDatabase.one<{ count: string }>('SELECT count(*)::text AS count FROM drawing')
    return Number(row?.count ?? 0)
  }

  private static toDomain(row: DrawingRow): Drawing {
    return {
      id: row.id,
      title: row.title,
      strokes: Array.isArray(row.strokes) ? row.strokes : [],
      background: row.background,
      width: row.width,
      height: row.height,
      createdAt: toIsoRequired(row.created_at),
      updatedAt: toIsoRequired(row.updated_at)
    }
  }
}
