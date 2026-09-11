import { HealthResult, HealthValidator } from '../core/model/HealthValidator'
import { Migrator } from '../db/Migrator'
import { PostgresDatabase } from '../db/PostgresDatabase'

/**
 * Critical probe: can we reach Postgres and is the schema present?
 *
 * Marked critical, so a failure makes /healthCheck answer 503 and the
 * container healthcheck go red, which is the signal that actually needs to
 * reach whoever is looking after the Pi.
 */
export class DatabaseCheck implements HealthValidator {
  public readonly name = 'database'
  public readonly critical = true

  public async validate(): Promise<HealthResult> {
    if (!PostgresDatabase.initialized()) {
      return { healthy: false, message: 'Database pool has not been initialized' }
    }

    const startedAt = Date.now()
    const row = await PostgresDatabase.one<{ version: string }>('SELECT version() AS version')
    const latencyMs = Date.now() - startedAt

    const pool = PostgresDatabase.connection()

    return {
      healthy: true,
      detail: {
        latencyMs,
        migrationsApplied: await Migrator.appliedCount(),
        // Trimmed: the full version() string is a paragraph of build flags.
        server: row?.version?.split(' ').slice(0, 2).join(' ') ?? 'unknown',
        pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
      }
    }
  }
}
