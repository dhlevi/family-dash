import { PostgresDatabase } from '../db/PostgresDatabase'

interface SettingRow {
  key: string
  value: unknown
}

/**
 * Reads and writes the `setting` table.
 *
 * Values are `jsonb`, so a setting can be a scalar, a list or an object
 * without a migration each time one changes shape.
 */
export class SettingRepository {
  /** Every stored setting. Keys nobody has written are absent, not null. */
  public async all(): Promise<Record<string, unknown>> {
    const rows = await PostgresDatabase.many<SettingRow>('SELECT key, value FROM setting')
    return Object.fromEntries(rows.map(row => [row.key, row.value]))
  }

  public async get(key: string): Promise<unknown | undefined> {
    const row = await PostgresDatabase.one<SettingRow>('SELECT key, value FROM setting WHERE key = $1', [key])
    return row ? row.value : undefined
  }

  public async set(key: string, value: unknown): Promise<void> {
    await PostgresDatabase.execute(
      `INSERT INTO setting (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    )
  }

  /**
   * Write several settings at once, in one transaction.
   *
   * The Settings page saves a whole section at a time; applying them
   * individually would leave a half-saved section behind if one failed.
   */
  public async setMany(values: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(values)
    if (entries.length === 0) return

    await PostgresDatabase.transaction(async client => {
      for (const [key, value] of entries) {
        await client.query(
          `INSERT INTO setting (key, value)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
          [key, JSON.stringify(value)]
        )
      }
    })
  }

  /** Remove a setting so it falls back to its catalogue default. */
  public async remove(key: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM setting WHERE key = $1', [key])) > 0
  }
}
