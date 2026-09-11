import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { PostgresDatabase } from './PostgresDatabase'

interface MigrationFile {
  id: string
  name: string
  filePath: string
  sql: string
  checksum: string
}

export interface MigrationOutcome {
  applied: string[]
  skipped: string[]
}

/**
 * Applies `db/migrations/NNN_name.sql` in filename order at startup.
 *
 * Each file runs inside its own transaction and is recorded in
 * `schema_migration` with a checksum, so a second boot is a no-op and an
 * edited file that has already been applied is reported loudly instead of
 * silently diverging. Keeping this in the API container means the Pi has
 * nothing to run by hand after a `git pull`
 */
export class Migrator {
  private constructor() {
    /* static only */
  }

  public static migrationsDirectory(): string {
    // Resolves under both `tsx lib/...` and the compiled `build/...` layout.
    const candidates = [
      path.resolve(__dirname, 'migrations'),
      path.resolve(process.cwd(), 'build/db/migrations'),
      path.resolve(process.cwd(), 'lib/db/migrations')
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }

    throw new Error(`Could not locate a migrations directory; looked in:\n  ${candidates.join('\n  ')}`)
  }

  public static async migrate(): Promise<MigrationOutcome> {
    await Migrator.ensureMigrationTable()

    const files = Migrator.load()
    const alreadyApplied = await Migrator.appliedMigrations()
    const outcome: MigrationOutcome = { applied: [], skipped: [] }

    // Every mismatch, not just the first. Reformatting a header comment tends
    // to touch several files at once, and reporting them one at a time turns
    // one fix into a restart-fail-reseal loop for as many files as were edited.
    const changed = files
      .filter(file => {
        const previous = alreadyApplied.get(file.id)
        return previous !== undefined && previous !== file.checksum
      })
      .map(file => file.name)

    if (changed.length > 0) {
      throw new Error(
        `${changed.length} migration(s) changed since they were applied (checksum mismatch): ${changed.join(', ')}. ` +
          'Migrations are immutable once applied. Add a new migration instead of editing one. ' +
          'If the changes were only to comments and the schema is unchanged, reseal them:\n' +
          `  docker compose run --rm --entrypoint sh api -c "node build/db/cli.js --reseal ${changed.join(' ')}"`
      )
    }

    for (const file of files) {
      const previous = alreadyApplied.get(file.id)

      if (previous) {
        outcome.skipped.push(file.name)
        continue
      }

      console.info(`Applying migration ${file.name}...`)

      await PostgresDatabase.transaction(async client => {
        await client.query(file.sql)
        await client.query('INSERT INTO schema_migration (id, name, checksum, applied_at) VALUES ($1, $2, $3, now())', [
          file.id,
          file.name,
          file.checksum
        ])
      })

      outcome.applied.push(file.name)
    }

    if (outcome.applied.length === 0) {
      console.info(`Database schema is up to date (${outcome.skipped.length} migration(s) already applied)`)
    } else {
      console.info(`Applied ${outcome.applied.length} migration(s): ${outcome.applied.join(', ')}`)
    }

    return outcome
  }

  /**
   * Records a migration's current checksum without re-running it.
   *
   * The immutability check is deliberately blunt: it hashes the whole file,
   * so correcting a typo in a comment stops the API from booting even though
   * the schema is untouched. Without a way out, the only remedies are
   * reverting an intentional edit or editing `schema_migration` by hand on
   * the Pi, so this is the way out, and it says plainly that the caller is
   * asserting the change was cosmetic.
   *
   * It cannot invent history: a migration that was never applied is refused,
   * because the fix there is to apply it.
   */
  public static async reseal(name: string): Promise<{ name: string; from: string; to: string }> {
    await Migrator.ensureMigrationTable()

    const file = Migrator.load().find(candidate => candidate.name === name || candidate.id === name)
    if (!file) {
      throw new Error(`No migration named '${name}' in ${Migrator.migrationsDirectory()}`)
    }

    const applied = await Migrator.appliedMigrations()
    const previous = applied.get(file.id)

    if (previous === undefined) {
      throw new Error(`Migration ${file.name} has not been applied, so there is no checksum to reseal.`)
    }

    if (previous === file.checksum) {
      throw new Error(`Migration ${file.name} already matches its recorded checksum; nothing to reseal.`)
    }

    await PostgresDatabase.execute('UPDATE schema_migration SET checksum = $1 WHERE id = $2', [file.checksum, file.id])

    return { name: file.name, from: previous, to: file.checksum }
  }

  public static async appliedCount(): Promise<number> {
    const row = await PostgresDatabase.one<{ count: string }>('SELECT count(*)::text AS count FROM schema_migration')
    return Number(row?.count ?? 0)
  }

  private static async ensureMigrationTable(): Promise<void> {
    await PostgresDatabase.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        id          text PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `)
  }

  private static async appliedMigrations(): Promise<Map<string, string>> {
    const rows = await PostgresDatabase.many<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migration'
    )
    return new Map(rows.map(row => [row.id, row.checksum]))
  }

  private static load(): MigrationFile[] {
    const directory = Migrator.migrationsDirectory()

    return fs
      .readdirSync(directory)
      .filter(name => name.endsWith('.sql'))
      .sort()
      .map(name => {
        const filePath = path.join(directory, name)
        const sql = fs.readFileSync(filePath, 'utf8')

        return {
          // The numeric prefix is the identity, so a file can be renamed for
          // clarity without looking like a new migration.
          id: name.split('_')[0] ?? name,
          name,
          filePath,
          sql,
          checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
        }
      })
  }
}
