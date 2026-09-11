import { PostgresDatabase } from '../db/PostgresDatabase'
import type { PlannedNotification } from '../services/notifications/plan'

export interface SentNotification {
  key: string
  kind: string
  title: string
  body: string
  fireAt: string
  sentAt: string | null
  suppressed: string | null
  detail: string | null
}

interface NotificationRow {
  dedupe_key: string
  kind: string
  title: string
  body: string
  fire_at: Date
  sent_at: Date | null
  suppressed: string | null
  detail: string | null
}

/**
 * The ledger of what has already been dealt with.
 */
export class NotificationRepository {
  /** Which of these keys have already been handled. */
  public async handled(keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set()

    const rows = await PostgresDatabase.many<{ dedupe_key: string }>(
      'SELECT dedupe_key FROM notification WHERE dedupe_key = ANY($1::text[])',
      [keys]
    )

    return new Set(rows.map(row => row.dedupe_key))
  }

  /**
   * Records one as handled.
   *
   * `ON CONFLICT DO NOTHING` rather than an upsert.
   *
   * Returns false when the row already existed, which the caller uses to know
   * it lost the race and must not send.
   */
  public async claim(
    planned: PlannedNotification,
    fireAt: Date,
    outcome: { sent: boolean; suppressed?: string }
  ): Promise<boolean> {
    const inserted = await PostgresDatabase.execute(
      `INSERT INTO notification (kind, dedupe_key, topic, title, body, fire_at, sent_at, suppressed, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        planned.kind,
        planned.key,
        planned.topic,
        planned.title,
        planned.body,
        fireAt,
        outcome.sent ? new Date() : null,
        outcome.suppressed ?? null,
        planned.detail ?? null
      ]
    )

    return inserted > 0
  }

  /**
   * Gives a claim back, so the next sweep tries again.
   *
   * Used when the send itself failed. Claiming before sending is what stops
   * two overlapping sweeps sending twice; releasing on failure is what stops
   * a claim from swallowing the reminder when ntfy was simply down.
   */
  public async release(key: string): Promise<void> {
    await PostgresDatabase.execute('DELETE FROM notification WHERE dedupe_key = $1', [key])
  }

  /**
   * The last thing recorded for a key prefix, newest first.
   *
   * Used for system faults, where the question is not "have I sent this" but
   * "is this the same fault I reported last time".
   */
  public async latestFor(prefix: string): Promise<SentNotification | null> {
    const row = await PostgresDatabase.one<NotificationRow>(
      `SELECT dedupe_key, kind, title, body, fire_at, sent_at, suppressed, detail
         FROM notification
        WHERE dedupe_key LIKE $1 || '%'
        ORDER BY created_at DESC
        LIMIT 1`,
      [prefix]
    )

    return row ? NotificationRepository.toDomain(row) : null
  }

  /** The recent history, for the Settings page. */
  public async recent(limit = 20): Promise<SentNotification[]> {
    const rows = await PostgresDatabase.many<NotificationRow>(
      `SELECT dedupe_key, kind, title, body, fire_at, sent_at, suppressed, detail
         FROM notification ORDER BY created_at DESC LIMIT $1`,
      [limit]
    )

    return rows.map(NotificationRepository.toDomain)
  }

  /**
   * Drops rows older than `days`.
   *
   * The ledger only has to remember long enough that a reminder cannot fire
   * twice. Keeping it forever would grow a table nobody reads.
   */
  public async prune(days: number): Promise<number> {
    return PostgresDatabase.execute(`DELETE FROM notification WHERE created_at < now() - ($1 || ' days')::interval`, [
      days
    ])
  }

  private static toDomain(row: NotificationRow): SentNotification {
    return {
      key: row.dedupe_key,
      kind: row.kind,
      title: row.title,
      body: row.body,
      fireAt: row.fire_at.toISOString(),
      sentAt: row.sent_at ? row.sent_at.toISOString() : null,
      suppressed: row.suppressed,
      detail: row.detail
    }
  }
}
