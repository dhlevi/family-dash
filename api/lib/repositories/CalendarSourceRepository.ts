import { PostgresDatabase } from '../db/PostgresDatabase'
import type { CalendarSource, CalendarSourceType } from '../types/domain'
import { buildUpdate, toIso } from './rows'

interface CalendarSourceRow {
  id: string
  type: CalendarSourceType
  name: string
  colour: string
  config: Record<string, unknown>
  enabled: boolean
  read_only: boolean
  last_sync_at: Date | null
  last_error: string | null
}

export interface NewCalendarSource {
  type: CalendarSourceType
  name: string
  colour?: string
  config?: Record<string, unknown>
  enabled?: boolean
  readOnly?: boolean
}

export interface CalendarSourceUpdate {
  name?: string
  colour?: string
  config?: Record<string, unknown>
  enabled?: boolean
}

const COLUMNS = 'id, type, name, colour, config, enabled, read_only, last_sync_at, last_error'

export class CalendarSourceRepository {
  public async all(): Promise<CalendarSource[]> {
    const rows = await PostgresDatabase.many<CalendarSourceRow>(
      `SELECT ${COLUMNS} FROM calendar_source ORDER BY type = 'local' DESC, name`
    )
    return rows.map(CalendarSourceRepository.toDomain)
  }

  public async enabled(): Promise<CalendarSource[]> {
    const rows = await PostgresDatabase.many<CalendarSourceRow>(
      `SELECT ${COLUMNS} FROM calendar_source WHERE enabled ORDER BY name`
    )
    return rows.map(CalendarSourceRepository.toDomain)
  }

  public async byId(id: string): Promise<CalendarSource | null> {
    const row = await PostgresDatabase.one<CalendarSourceRow>(`SELECT ${COLUMNS} FROM calendar_source WHERE id = $1`, [
      id
    ])
    return row ? CalendarSourceRepository.toDomain(row) : null
  }

  /** The writable local source. Every install has exactly one, seeded by the first migration. */
  public async localSource(): Promise<CalendarSource | null> {
    const row = await PostgresDatabase.one<CalendarSourceRow>(
      `SELECT ${COLUMNS} FROM calendar_source WHERE type = 'local' ORDER BY created_at LIMIT 1`
    )
    return row ? CalendarSourceRepository.toDomain(row) : null
  }

  public async create(source: NewCalendarSource): Promise<CalendarSource> {
    const row = await PostgresDatabase.one<CalendarSourceRow>(
      `INSERT INTO calendar_source (type, name, colour, config, enabled, read_only)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        source.type,
        source.name,
        source.colour ?? '#4f8ef7',
        JSON.stringify(source.config ?? {}),
        source.enabled ?? true,
        // Feed subscriptions cannot be written back to; only local (and later
        // Google) sources accept new events.
        source.readOnly ?? source.type !== 'local'
      ]
    )
    return CalendarSourceRepository.toDomain(row as CalendarSourceRow)
  }

  public async update(id: string, changes: CalendarSourceUpdate): Promise<CalendarSource | null> {
    const { clause, params } = buildUpdate(
      {
        name: changes.name,
        colour: changes.colour,
        config: changes.config === undefined ? undefined : JSON.stringify(changes.config),
        enabled: changes.enabled
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<CalendarSourceRow>(
      `UPDATE calendar_source SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? CalendarSourceRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    // Cached events cascade with the source.
    return (await PostgresDatabase.execute('DELETE FROM calendar_source WHERE id = $1', [id])) > 0
  }

  /**
   * Record the outcome of a sync. Storing the error rather than only logging
   * it is what lets the Settings page explain why a feed looks stale.
   */
  public async recordSync(id: string, error: string | null): Promise<void> {
    await PostgresDatabase.execute('UPDATE calendar_source SET last_sync_at = now(), last_error = $2 WHERE id = $1', [
      id,
      error
    ])
  }

  private static toDomain(row: CalendarSourceRow): CalendarSource {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      colour: row.colour,
      enabled: row.enabled,
      readOnly: row.read_only,
      lastSyncAt: toIso(row.last_sync_at),
      lastError: row.last_error,
      config: row.config ?? {}
    }
  }
}
