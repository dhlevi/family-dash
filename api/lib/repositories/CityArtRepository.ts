import { PostgresDatabase } from '../db/PostgresDatabase'
import { cityArtUrls } from '../services/mediaUrls'
import { themeById } from '../providers/map/themes'
import { toIsoRequired } from './rows'
import type { CityArt, CityArtFile } from '../types/domain'

interface CityArtRow {
  id: string
  city_key: string
  city_name: string
  region: string
  country: string
  latitude: number
  longitude: number
  theme: string
  svg_path: string
  raster_path: string | null
  width: number
  height: number
  feature_count: number
  created_at: Date
  updated_at: Date
}

/**
 * The generated artwork index.
 *
 * A cache table: every row can be deleted and the next run of the background
 * task will draw more. The only thing worth protecting is the pairing between
 * a row and its two files, which is why deletes go through `remove` rather
 * than being issued ad hoc.
 */
export class CityArtRepository {
  private static map(row: CityArtRow): CityArt {
    // A theme that has been renamed or dropped between releases should not
    // hide an artwork that is still perfectly good on disk, so fall back to
    // something neutral rather than failing the read.
    const theme = themeById(row.theme)

    return {
      id: row.id,
      cityKey: row.city_key,
      cityName: row.city_name,
      region: row.region,
      country: row.country,
      latitude: row.latitude,
      longitude: row.longitude,
      theme: row.theme,
      themeName: theme?.name ?? row.theme,
      background: theme?.background ?? '#000000',
      width: row.width,
      height: row.height,
      ...cityArtUrls(row.id, row.updated_at),
      createdAt: toIsoRequired(row.created_at)
    }
  }

  private static readonly COLUMNS = `id, city_key, city_name, region, country, latitude, longitude,
       theme, svg_path, raster_path, width, height, feature_count, created_at, updated_at`

  /** Newest first, which is the order the screensaver shows them in. */
  public async list(limit = 20): Promise<CityArt[]> {
    const rows = await PostgresDatabase.many<CityArtRow>(
      `SELECT ${CityArtRepository.COLUMNS} FROM city_art ORDER BY created_at DESC LIMIT $1`,
      [limit]
    )

    return rows.map(CityArtRepository.map)
  }

  public async byId(id: string): Promise<CityArt | null> {
    const row = await PostgresDatabase.one<CityArtRow>(
      `SELECT ${CityArtRepository.COLUMNS} FROM city_art WHERE id = $1`,
      [id]
    )

    return row ? CityArtRepository.map(row) : null
  }

  /** The file paths behind an artwork, for the controller that serves them. */
  public async fileFor(id: string): Promise<CityArtFile | null> {
    const row = await PostgresDatabase.one<{
      id: string
      svg_path: string
      raster_path: string | null
      city_name: string
    }>('SELECT id, svg_path, raster_path, city_name FROM city_art WHERE id = $1', [id])

    return row ? { id: row.id, svgPath: row.svg_path, rasterPath: row.raster_path, cityName: row.city_name } : null
  }

  public async count(): Promise<number> {
    const row = await PostgresDatabase.one<{ total: string }>('SELECT count(*)::text AS total FROM city_art')
    return Number(row?.total ?? 0)
  }

  /**
   * Which cities have been drawn lately, newest first.
   *
   * The generator uses this to avoid repeating itself: with a pool of a dozen
   * pictures and four hundred cities, drawing the same place twice in a week
   * is the difference between a screensaver that feels alive and one that
   * looks broken.
   */
  public async recentCityKeys(limit: number): Promise<string[]> {
    const rows = await PostgresDatabase.many<{ city_key: string }>(
      'SELECT city_key FROM city_art ORDER BY created_at DESC LIMIT $1',
      [limit]
    )

    return rows.map(row => row.city_key)
  }

  public async insert(art: {
    cityKey: string
    cityName: string
    region: string
    country: string
    latitude: number
    longitude: number
    theme: string
    svgPath: string
    rasterPath: string | null
    width: number
    height: number
    featureCount: number
  }): Promise<CityArt> {
    const row = await PostgresDatabase.one<CityArtRow>(
      `INSERT INTO city_art (city_key, city_name, region, country, latitude, longitude,
                             theme, svg_path, raster_path, width, height, feature_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${CityArtRepository.COLUMNS}`,
      [
        art.cityKey,
        art.cityName,
        art.region,
        art.country,
        art.latitude,
        art.longitude,
        art.theme,
        art.svgPath,
        art.rasterPath,
        art.width,
        art.height,
        art.featureCount
      ]
    )

    if (!row) throw new Error('Inserting the artwork returned no row')

    return CityArtRepository.map(row)
  }

  /**
   * Deletes an artwork, returning the files that are now orphaned.
   *
   * The caller removes them. Returning the paths rather than deleting here
   * keeps filesystem work out of the repository, and means a failed file
   * delete cannot leave a row pointing at nothing.
   */
  public async remove(id: string): Promise<{ svgPath: string; rasterPath: string | null } | null> {
    const row = await PostgresDatabase.one<{ svg_path: string; raster_path: string | null }>(
      'DELETE FROM city_art WHERE id = $1 RETURNING svg_path, raster_path',
      [id]
    )

    return row ? { svgPath: row.svg_path, rasterPath: row.raster_path } : null
  }

  /** Drops everything past the newest `keep`, returning their files. */
  public async trimTo(keep: number): Promise<Array<{ svgPath: string; rasterPath: string | null }>> {
    const rows = await PostgresDatabase.many<{ svg_path: string; raster_path: string | null }>(
      `DELETE FROM city_art
        WHERE id IN (SELECT id FROM city_art ORDER BY created_at DESC OFFSET $1)
        RETURNING svg_path, raster_path`,
      [Math.max(keep, 0)]
    )

    return rows.map(row => ({ svgPath: row.svg_path, rasterPath: row.raster_path }))
  }
}
