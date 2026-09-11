/**
 * Standalone migration runner: `npm run migrate`.
 *
 * The API migrates on startup, so this is for the times you want to apply
 * migrations without booting the service, checking a new migration locally,
 * or repairing a database by hand.
 *
 *   npm run migrate
 *   npm run migrate -- --reseal 001_init.sql 002_note_ink.sql
 *
 * In the built container there is no tsx, so it is:
 *
 *   node build/db/cli.js --reseal 001_init.sql
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
    // Several names, because reformatting a header comment tends to touch more
    // than one file and the startup error now reports them all together.
    const names = process.argv.slice(resealIndex + 1).filter(argument => !argument.startsWith('--'))
    if (names.length === 0) throw new Error('--reseal needs one or more migration names, e.g. --reseal 001_init.sql')

    for (const name of names) {
      const resealed = await Migrator.reseal(name)

      console.warn(`\nResealed ${resealed.name}.\n  was ${resealed.from}\n  now ${resealed.to}`)
    }

    console.warn(
      '\nThis asserts the files changed but the schema they produce did not. If that is not true, ' +
        'the database and the migrations have diverged and nothing here will tell you so later.'
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
