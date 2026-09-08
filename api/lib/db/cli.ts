/**
 * Standalone migration runner: `npm run migrate`.
 *
 * The API migrates on startup, so this is for the times you want to apply
 * migrations without booting the service — checking a new migration locally,
 * or repairing a database by hand.
 *
 *   npm run migrate
 *   npm run migrate -- --reseal 001_init.sql
 *
 * `--reseal` records a migration's current checksum without re-running it,
 * for when an applied file was edited but its schema was not: a corrected
 * comment otherwise stops the API booting, and reverting somebody's edit or
 * hand-editing `schema_migration` are both worse answers.
 */
import { AppProperties } from '../core/AppProperties'
import { Migrator } from './Migrator'
import { PostgresDatabase } from './PostgresDatabase'

async function main(): Promise<void> {
  AppProperties.initialize()
  await PostgresDatabase.initialize()
  await PostgresDatabase.waitForConnection()

  const resealIndex = process.argv.indexOf('--reseal')

  if (resealIndex !== -1) {
    const name = process.argv[resealIndex + 1]
    if (!name) throw new Error('--reseal needs the name of a migration, e.g. --reseal 001_init.sql')

    const resealed = await Migrator.reseal(name)

    console.warn(
      `\nResealed ${resealed.name}.\n` +
        `  was ${resealed.from}\n` +
        `  now ${resealed.to}\n` +
        'This asserts the file changed but the schema it produces did not. If that is not true, ' +
        'the database and the migration have diverged and nothing here will tell you so later.'
    )

    await PostgresDatabase.shutdown()
    return
  }

  const outcome = await Migrator.migrate()

  console.info(`\nApplied: ${outcome.applied.length}   Already present: ${outcome.skipped.length}`)
  await PostgresDatabase.shutdown()
}

main().catch(error => {
  console.error('Migration failed', error)
  process.exit(1)
})
