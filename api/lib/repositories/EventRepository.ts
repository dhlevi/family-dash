import { PostgresDatabase } from '../db/PostgresDatabase'
import type { CalendarEvent, DateRange, ProviderEvent } from '../types/domain'
import { buildUpdate, toIsoRequired } from './rows'

interface EventRow {
  id: string
  source_id: string
  external_uid: string | null
  title: string
  description: string | null
  location: string | null
  starts_at: Date
  ends_at: Date
  all_day: boolean
  rrule: string | null
  colour: string | null
}

export interface NewEvent {
  sourceId: string
  /**
   * The upstream's own id, when the event was pushed to a remote calendar as
   * it was created. Null for events that live only here.
   */
  externalUid?: string | null
  title: string
  description?: string | null
  location?: string | null
  startsAt: Date
  endsAt: Date
  allDay?: boolean
  colour?: string | null
}

export interface EventUpdate {
  title?: string
  description?: string | null
  location?: string | null
  startsAt?: Date
  endsAt?: Date
  allDay?: boolean
  colour?: string | null
}

const COLUMNS = 'id, source_id, external_uid, title, description, location, starts_at, ends_at, all_day, rrule, colour'

export class EventRepository {
  /**
   * Events overlapping a range, across every enabled source.
   *
   * This is the query behind the calendar grid and the dashboard's "up next"
   * widget, and it reads only the local cache — the background sync is what
   * talks to feeds. The overlap test is deliberately inclusive at the start
   * so a zero-length event exactly on the boundary is not dropped.
   */
  public async inRange(range: DateRange, sourceIds?: string[]): Promise<CalendarEvent[]> {
    const params: unknown[] = [range.from, range.to]
    let sourceFilter = ''

    if (sourceIds && sourceIds.length > 0) {
      params.push(sourceIds)
      sourceFilter = `AND e.source_id = ANY($${params.length}::uuid[])`
    }

    const rows = await PostgresDatabase.many<EventRow>(
      `SELECT ${COLUMNS.split(', ')
        .map(column => `e.${column}`)
        .join(', ')}
       FROM event e
       JOIN calendar_source s ON s.id = e.source_id
       WHERE s.enabled
         AND e.starts_at < $2
         AND e.ends_at >= $1
         ${sourceFilter}
       ORDER BY e.all_day DESC, e.starts_at, e.title`,
      params
    )

    return rows.map(EventRepository.toDomain)
  }

  /** The next events starting from now, for the dashboard widget. */
  public async upcoming(limit: number, withinDays: number): Promise<CalendarEvent[]> {
    const rows = await PostgresDatabase.many<EventRow>(
      `SELECT ${COLUMNS.split(', ')
        .map(column => `e.${column}`)
        .join(', ')}
       FROM event e
       JOIN calendar_source s ON s.id = e.source_id
       WHERE s.enabled
         AND e.ends_at >= now()
         AND e.starts_at < now() + ($2 || ' days')::interval
       ORDER BY e.starts_at, e.all_day DESC, e.title
       LIMIT $1`,
      [limit, withinDays]
    )
    return rows.map(EventRepository.toDomain)
  }

  public async byId(id: string): Promise<CalendarEvent | null> {
    const row = await PostgresDatabase.one<EventRow>(`SELECT ${COLUMNS} FROM event WHERE id = $1`, [id])
    return row ? EventRepository.toDomain(row) : null
  }

  public async create(event: NewEvent): Promise<CalendarEvent> {
    const row = await PostgresDatabase.one<EventRow>(
      `INSERT INTO event (source_id, external_uid, title, description, location, starts_at, ends_at, all_day, colour)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        event.sourceId,
        event.externalUid ?? null,
        event.title,
        event.description ?? null,
        event.location ?? null,
        event.startsAt,
        event.endsAt,
        event.allDay ?? false,
        event.colour ?? null
      ]
    )
    return EventRepository.toDomain(row as EventRow)
  }

  public async update(id: string, changes: EventUpdate): Promise<CalendarEvent | null> {
    const { clause, params } = buildUpdate(
      {
        title: changes.title,
        description: changes.description,
        location: changes.location,
        starts_at: changes.startsAt,
        ends_at: changes.endsAt,
        all_day: changes.allDay,
        colour: changes.colour
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<EventRow>(
      `UPDATE event SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? EventRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM event WHERE id = $1', [id])) > 0
  }

  /**
   * Replace a feed's cached events inside a window.
   *
   * Delete-then-insert rather than a diff: it is far simpler and it handles
   * upstream deletions for free, which a diff on uid alone does not. Doing
   * it in one transaction means readers never observe the empty middle.
   *
   * Only rows with an `external_uid` are touched, so a locally created event
   * can never be swept away by a sync.
   */
  public async replaceWindow(sourceId: string, range: DateRange, events: ProviderEvent[]): Promise<number> {
    return PostgresDatabase.transaction(async client => {
      await client.query(
        `DELETE FROM event
         WHERE source_id = $1
           AND external_uid IS NOT NULL
           AND starts_at < $3
           AND ends_at >= $2`,
        [sourceId, range.from, range.to]
      )

      let inserted = 0
      for (const event of events) {
        // Occurrences of a recurring event share a UID, so the stored key
        // carries the occurrence start to keep (source_id, external_uid)
        // unique. See the partial index in 001_init.sql.
        const externalUid =
          event.rrule && event.externalUid ? `${event.externalUid}::${event.startsAt.toISOString()}` : event.externalUid

        const result = await client.query(
          `INSERT INTO event (source_id, external_uid, title, description, location,
                              starts_at, ends_at, all_day, rrule)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (source_id, external_uid) WHERE external_uid IS NOT NULL
           DO UPDATE SET title = excluded.title,
                         description = excluded.description,
                         location = excluded.location,
                         starts_at = excluded.starts_at,
                         ends_at = excluded.ends_at,
                         all_day = excluded.all_day,
                         rrule = excluded.rrule,
                         updated_at = now()`,
          [
            sourceId,
            externalUid,
            event.title,
            event.description,
            event.location,
            event.startsAt,
            event.endsAt,
            event.allDay,
            event.rrule
          ]
        )
        inserted += result.rowCount ?? 0
      }

      return inserted
    })
  }

  public async countBySource(sourceId: string): Promise<number> {
    const row = await PostgresDatabase.one<{ count: string }>(
      'SELECT count(*)::text AS count FROM event WHERE source_id = $1',
      [sourceId]
    )
    return Number(row?.count ?? 0)
  }

  private static toDomain(row: EventRow): CalendarEvent {
    return {
      id: row.id,
      sourceId: row.source_id,
      externalUid: row.external_uid,
      title: row.title,
      description: row.description,
      location: row.location,
      startsAt: toIsoRequired(row.starts_at),
      endsAt: toIsoRequired(row.ends_at),
      allDay: row.all_day,
      rrule: row.rrule,
      colour: row.colour
    }
  }
}
