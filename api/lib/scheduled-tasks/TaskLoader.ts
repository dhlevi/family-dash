import { AppProperties } from '../core/AppProperties'
import { TaskManager } from '../core/TaskManager'
import { calendarSyncTask } from './CalendarSyncTask'
import { cityArtRefreshTask } from './CityArtRefreshTask'
import { newsFetchTask } from './NewsFetchTask'
import { notificationSweepTask } from './NotificationSweepTask'
import { photoScanTask } from './PhotoScanTask'
import { weatherRefreshTask } from './WeatherRefreshTask'

/**
 * Registers the background refresh jobs with the TaskManager.
 *
 * These are what keep the dashboard fast and offline-tolerant: feeds are
 * pulled into Postgres on a schedule and the UI only reads the database.
 *
 * Cron expressions come from the `[tasks]` section of
 * config/application.properties so they can be tuned per install without a
 * rebuild.
 */
export function registerTasks(): void {
  TaskManager.register(
    calendarSyncTask,
    weatherRefreshTask,
    newsFetchTask,
    photoScanTask,
    cityArtRefreshTask,
    notificationSweepTask
  )

  const registered = TaskManager.names()
  console.info(
    registered.length > 0 ? `Registered tasks: ${registered.join(', ')}` : 'No background tasks registered yet'
  )

  if (!AppProperties.getBoolean('tasks.enabled', true)) {
    console.warn('Background tasks are registered but disabled by configuration')
  }
}
