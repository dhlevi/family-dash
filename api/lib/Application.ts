import { AppProperties } from './core/AppProperties'
import { TaskManager } from './core/TaskManager'
import { ExpressServer } from './ExpressServer'
import { Migrator } from './db/Migrator'
import { PostgresDatabase } from './db/PostgresDatabase'
import { registerCalendarProviders } from './providers/calendar'
import { registerWeatherProviders } from './providers/weather'
import { registerTasks } from './scheduled-tasks/TaskLoader'

/**
 * Startup and shutdown for the service.
 *
 * The startup order matters: configuration, then the database (including
 * migrations) before anything that reads it, then the HTTP listener, and only
 * then the background tasks, so a scheduled sync can never fire against an
 * un-migrated schema.
 */
export class Application {
  public static async createApplication(): Promise<ExpressServer> {
    AppProperties.initialize()

    await PostgresDatabase.initialize()
    await PostgresDatabase.waitForConnection()

    if (AppProperties.getBoolean('database.migrate.onStartup', true)) {
      await Migrator.migrate()
    } else {
      console.warn('Startup migrations are disabled; run `npm run migrate` yourself')
    }

    // Providers must be registered before the router is built: the calendar
    // endpoints ask the registry whether a source type is writable.
    registerCalendarProviders()
    registerWeatherProviders()

    const port = AppProperties.getNumber('server.port', 3000)
    const expressServer = new ExpressServer()
    await expressServer.setup(port)

    if (AppProperties.getBoolean('tasks.enabled', true)) {
      registerTasks()
      await TaskManager.start()
    } else {
      console.warn('Background tasks are disabled; feeds will not refresh on their own')
    }

    Application.handleExit(expressServer)

    return expressServer
  }

  private static handleExit(express: ExpressServer): void {
    let shuttingDown = false

    const shutdown = (exitCode: number, reason: string) => {
      if (shuttingDown) return
      shuttingDown = true
      console.info(`Shutting down (${reason})`)
      void Application.cleanShutdown(exitCode, express)
    }

    process.on('uncaughtException', error => {
      console.error('Uncaught exception', error)
      shutdown(1, 'uncaughtException')
    })

    process.on('unhandledRejection', reason => {
      console.error('Unhandled rejection', reason)
      shutdown(2, 'unhandledRejection')
    })

    // SIGTERM is what `docker compose down` and `docker compose restart` send.
    process.on('SIGTERM', () => shutdown(0, 'SIGTERM'))
    process.on('SIGINT', () => shutdown(0, 'SIGINT'))
  }

  private static async cleanShutdown(exitCode: number, express: ExpressServer): Promise<void> {
    // Order mirrors startup in reverse: stop accepting work, stop scheduled
    // work, then close the pool the work was using.
    try {
      await express.kill()
      TaskManager.clearTasks()
      await PostgresDatabase.shutdown()
      console.info('Shutdown complete')
      process.exit(exitCode)
    } catch (error) {
      console.error('Error during shutdown', error)
      process.exit(1)
    }
  }
}
