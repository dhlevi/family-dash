import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { AppProperties } from '../core/AppProperties'

/**
 * The connection pool, as a singleton.
 *
 * Ported from the template's PostgresDatabase, with two changes that matter:
 * `query` takes parameters (the template's took a bare SQL string, which is
 * an injection waiting to happen once user input is involved), and there is
 * a `transaction` helper so multi-statement work like "save a meal plan and
 * its shopping list" is atomic.
 *
 * Connection details come from the standard PG* environment variables, which
 * `new Pool()` reads on its own: PGHOST, PGPORT, PGDATABASE, PGUSER,
 * PGPASSWORD. docker-compose sets them.
 */
export class PostgresDatabase {
  private static _instance: PostgresDatabase | null = null
  private pool: Pool | null = null
  private _initialized = false

  private constructor() {
    /* use the static API */
  }

  private static instance(): PostgresDatabase {
    PostgresDatabase._instance ??= new PostgresDatabase()
    return PostgresDatabase._instance
  }

  public static initialized(): boolean {
    return PostgresDatabase.instance()._initialized
  }

  public static connection(): Pool {
    const pool = PostgresDatabase.instance().pool
    if (!pool) throw new Error('Database has not been initialized; call PostgresDatabase.initialize() first')
    return pool
  }

  public static async initialize(): Promise<void> {
    const self = PostgresDatabase.instance()
    if (self._initialized) return

    console.info('Initializing database pool...')

    self.pool = new Pool({
      max: AppProperties.getNumber('database.pool.max', 8),
      idleTimeoutMillis: AppProperties.getNumber('database.pool.idleTimeoutMillis', 30000),
      connectionTimeoutMillis: AppProperties.getNumber('database.pool.connectionTimeoutMillis', 10000)
    })

    // An idle client erroring out (a database restart, for instance) emits on
    // the pool. Without a listener, Node treats it as an unhandled 'error'
    // event and takes the process down.
    self.pool.on('error', error => {
      console.error('Idle database client error', error)
    })

    self._initialized = true
    console.info('Database pool ready')
  }

  /**
   * Wait for Postgres to accept connections.
   *
   * `depends_on: service_healthy` covers the normal case, but a Pi rebooting
   * with a cold SD card can still have the API dial in before Postgres is
   * listening, so retry rather than crash-loop the container.
   */
  public static async waitForConnection(attempts = 15, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await PostgresDatabase.connection().query('SELECT 1')
        console.info('Database connection established')
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt === attempts) {
          throw new Error(`Could not reach the database after ${attempts} attempts: ${message}`, {
            cause: error
          })
        }
        console.warn(`Database not ready (attempt ${attempt}/${attempts}): ${message}`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  public static async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    if (AppProperties.getString('logging.level', 'info') === 'debug') {
      console.debug('SQL:', sql.replace(/\s+/g, ' ').trim(), params.length > 0 ? params : '')
    }
    return PostgresDatabase.connection().query<T>(sql, params as never[])
  }

  /** All matching rows. */
  public static async many<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await PostgresDatabase.query<T>(sql, params)
    return result.rows
  }

  /** The first row, or null. */
  public static async one<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const result = await PostgresDatabase.query<T>(sql, params)
    return result.rows[0] ?? null
  }

  /** Rows affected by an INSERT/UPDATE/DELETE. */
  public static async execute(sql: string, params: unknown[] = []): Promise<number> {
    const result = await PostgresDatabase.query(sql, params)
    return result.rowCount ?? 0
  }

  /**
   * Run `work` inside a transaction, committing on success and rolling back
   * on any throw. The client is always released.
   */
  public static async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await PostgresDatabase.connection().connect()

    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        console.error('Rollback failed', rollbackError)
      }
      throw error
    } finally {
      client.release()
    }
  }

  public static async shutdown(): Promise<void> {
    const self = PostgresDatabase.instance()
    if (!self.pool) return

    await self.pool.end()
    self.pool = null
    self._initialized = false
    console.info('Database pool closed')
  }
}
