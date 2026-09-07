import { TaskManager } from '../core/TaskManager'

/**
 * Registers the background refresh jobs with the TaskManager.
 *
 * Empty for now — the calendar, news, weather and photo-scan tasks arrive
 * with their features. Cron expressions come from the `[tasks]` section of
 * config/application.properties so they can be tuned per install without a
 * rebuild (a Pi on a metered connection may not want news every 30 minutes).
 */
export function registerTasks(): void {
  TaskManager.register()

  const registered = TaskManager.names()
  console.info(
    registered.length > 0 ? `Registered tasks: ${registered.join(', ')}` : 'No background tasks registered yet'
  )
}
