import { PostgresDatabase } from '../db/PostgresDatabase'
import { photoUrls } from '../services/mediaUrls'
import type { Photo, PhotoAlbum, PhotoFile } from '../types/domain'
import { buildUpdate, toIso, toIsoRequired } from './rows'

interface PhotoRow {
  id: string
  rel_path: string
  album: string
  filename: string
  mime_type: string | null
  width: number | null
  height: number | null
  size_bytes: string | null
  taken_at: Date | null
  thumb_path: string | null
  favourite: boolean
  created_at: Date
  updated_at: Date
}

export interface NewPhoto {
  relPath: string
  album: string
  filename: string
  mimeType?: string | null
  width?: number | null
  height?: number | null
  sizeBytes?: number | null
  takenAt?: Date | null
  thumbPath?: string | null
}

export interface PhotoUpdate {
  album?: string
  width?: number | null
  height?: number | null
  sizeBytes?: number | null
  takenAt?: Date | null
  thumbPath?: string | null
  favourite?: boolean
}

export interface PhotoFilter {
  album?: string
  favouritesOnly?: boolean
  limit?: number
  offset?: number
}

const COLUMNS =
  'id, rel_path, album, filename, mime_type, width, height, size_bytes, ' +
  'taken_at, thumb_path, favourite, created_at, updated_at'

/**
 * Newest first, with photos whose date is unknown at the end rather than
 * scattered through by insertion order. `id` breaks ties so paging is
 * stable — without it two photos sharing a timestamp can swap places between
 * pages and one of them never appears.
 */
const NEWEST_FIRST = 'ORDER BY taken_at DESC NULLS LAST, created_at DESC, id'

export class PhotoRepository {
  public async list(filter: PhotoFilter = {}): Promise<Photo[]> {
    const conditions: string[] = []
    const params: unknown[] = []

    // An explicit empty album is meaningful: the loose files at the top of
    // the library. Only `undefined` means "every album".
    if (filter.album !== undefined) {
      params.push(filter.album)
      conditions.push(`album = $${params.length}`)
    }

    if (filter.favouritesOnly) conditions.push('favourite')

    let limitClause = ''
    if (filter.limit !== undefined) {
      params.push(Math.min(Math.max(filter.limit, 1), 1000))
      limitClause = `LIMIT $${params.length}`
    }

    let offsetClause = ''
    if (filter.offset !== undefined && filter.offset > 0) {
      params.push(filter.offset)
      offsetClause = `OFFSET $${params.length}`
    }

    const rows = await PostgresDatabase.many<PhotoRow>(
      `SELECT ${COLUMNS} FROM photo
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ${NEWEST_FIRST}
       ${limitClause} ${offsetClause}`,
      params
    )

    return rows.map(PhotoRepository.toDomain)
  }

  public async byId(id: string): Promise<Photo | null> {
    const row = await PostgresDatabase.one<PhotoRow>(`SELECT ${COLUMNS} FROM photo WHERE id = $1`, [id])
    return row ? PhotoRepository.toDomain(row) : null
  }

  /** Where a photo's files are, for the routes that serve them. */
  public async fileFor(id: string): Promise<PhotoFile | null> {
    const row = await PostgresDatabase.one<{
      id: string
      rel_path: string
      thumb_path: string | null
      mime_type: string | null
      filename: string
    }>('SELECT id, rel_path, thumb_path, mime_type, filename FROM photo WHERE id = $1', [id])

    return row
      ? {
          id: row.id,
          relPath: row.rel_path,
          thumbPath: row.thumb_path,
          mimeType: row.mime_type,
          filename: row.filename
        }
      : null
  }

  public async byRelPath(relPath: string): Promise<Photo | null> {
    const row = await PostgresDatabase.one<PhotoRow>(`SELECT ${COLUMNS} FROM photo WHERE rel_path = $1`, [relPath])
    return row ? PhotoRepository.toDomain(row) : null
  }

  /** Every indexed library path, for a scan to compare the filesystem against. */
  public async allRelPaths(): Promise<Map<string, { id: string; thumbPath: string | null; sizeBytes: number | null }>> {
    const rows = await PostgresDatabase.many<{
      id: string
      rel_path: string
      thumb_path: string | null
      size_bytes: string | null
    }>('SELECT id, rel_path, thumb_path, size_bytes FROM photo')

    return new Map(
      rows.map(row => [
        row.rel_path,
        { id: row.id, thumbPath: row.thumb_path, sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes) }
      ])
    )
  }

  /** Albums with their sizes and a cover, for the album browser. */
  public async albums(): Promise<PhotoAlbum[]> {
    const rows = await PostgresDatabase.many<{
      album: string
      count: string
      cover_photo_id: string | null
      latest_taken_at: Date | null
    }>(
      `SELECT album,
              count(*)::text AS count,
              (SELECT inner_photo.id
                 FROM photo inner_photo
                WHERE inner_photo.album = outer_photo.album
                ${NEWEST_FIRST}
                LIMIT 1) AS cover_photo_id,
              max(taken_at) AS latest_taken_at
         FROM photo outer_photo
        GROUP BY album
        ORDER BY album = '' , lower(album)`
    )

    return rows.map(row => ({
      name: row.album,
      count: Number(row.count),
      coverPhotoId: row.cover_photo_id,
      latestTakenAt: toIso(row.latest_taken_at)
    }))
  }

  public async create(photo: NewPhoto): Promise<Photo> {
    const row = await PostgresDatabase.one<PhotoRow>(
      `INSERT INTO photo (rel_path, album, filename, mime_type, width, height, size_bytes, taken_at, thumb_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        photo.relPath,
        photo.album,
        photo.filename,
        photo.mimeType ?? null,
        photo.width ?? null,
        photo.height ?? null,
        photo.sizeBytes ?? null,
        photo.takenAt ?? null,
        photo.thumbPath ?? null
      ]
    )
    return PhotoRepository.toDomain(row as PhotoRow)
  }

  public async update(id: string, changes: PhotoUpdate): Promise<Photo | null> {
    const { clause, params } = buildUpdate(
      {
        album: changes.album,
        width: changes.width,
        height: changes.height,
        size_bytes: changes.sizeBytes,
        taken_at: changes.takenAt,
        thumb_path: changes.thumbPath,
        favourite: changes.favourite
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<PhotoRow>(
      `UPDATE photo SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? PhotoRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM photo WHERE id = $1', [id])) > 0
  }

  /** Drops index rows whose files have gone, returning how many. */
  public async removeByRelPaths(relPaths: string[]): Promise<number> {
    if (relPaths.length === 0) return 0
    return PostgresDatabase.execute('DELETE FROM photo WHERE rel_path = ANY($1::text[])', [relPaths])
  }

  public async count(album?: string): Promise<number> {
    const row =
      album === undefined
        ? await PostgresDatabase.one<{ count: string }>('SELECT count(*)::text AS count FROM photo')
        : await PostgresDatabase.one<{ count: string }>('SELECT count(*)::text AS count FROM photo WHERE album = $1', [
            album
          ])

    return Number(row?.count ?? 0)
  }

  private static toDomain(row: PhotoRow): Photo {
    return {
      id: row.id,
      album: row.album,
      filename: row.filename,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      // bigint arrives as a string, because it can exceed a JS number. A
      // photo cannot, so this is safe to narrow.
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      takenAt: toIso(row.taken_at),
      ...photoUrls(row.id, row.updated_at),
      favourite: row.favourite,
      createdAt: toIsoRequired(row.created_at),
      updatedAt: toIsoRequired(row.updated_at)
    }
  }
}
