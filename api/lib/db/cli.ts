/**
 * Standalone migration runner: `npm run migrate`.
 *
 * The API migrates on startup, so this is for the times you want to apply
 * migrations without booting the service — checking a new migration locally,
 * or repairing a database by hand.
 */
import { AppProperties } from '../core/AppProperties'
import { Migrator } from './Migrator'
import { PostgresDatabase } from './PostgresDatabase'

async function main(): Promise<void> {
  AppProperties.initialize()
  await PostgresDatabase.initialize()
  await PostgresDatabase.waitForConnection()

  const outcome = await Migrator.migrate()

  console.info(`\nApplied: ${outcome.applied.length}   Already present: ${outcome.skipped.length}`)
  await PostgresDatabase.shutdown()
}

main().catch(error => {
  console.error('Migration failed', error)
  process.exit(1)
})
