import { AppProperties } from '../core/AppProperties'
import { CalendarSyncService } from '../services/CalendarSyncService'
import type { Task } from '../core/model/Task'

const service = new CalendarSyncService()

/**
 * Keeps subscribed calendar feeds cached in Postgres.
 *
 * Runs on startup as well as on its schedule, so a Pi that has been switched
 * off for a week shows current events as soon as it boots rather than at the
 * top of the next interval.
 */
export const calendarSyncTask: Task = {
  name: 'calendar-sync',
  get cron() {
    return AppProperties.getString('tasks.calendar.sync.cron', '*/15 * * * *')
  },
  enabled: true,
  runOnStartup: true,
  async execute() {
    await service.syncAll()
  }
}
