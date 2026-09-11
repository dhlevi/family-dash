import { AppProperties } from '../core/AppProperties'
import { NotificationService } from '../services/NotificationService'
import type { Task } from '../core/model/Task'

const service = new NotificationService()

/**
 * Sends whatever is due to be said.
 *
 * Every few minutes rather than on a timer per reminder: a process that holds
 * timers loses them all on restart, and a Raspberry Pi restarts; for a power
 * cut, an update, or a container rebuild. Everything this needs to know is in
 * Postgres, so a sweep picks up exactly where the last one stopped.
 *
 * Not run on startup. A container that is restarting in a loop would otherwise
 * sweep on every attempt, and the first thing anybody would know about it is
 * their phone.
 */
export const notificationSweepTask: Task = {
  name: 'notification-sweep',
  get cron() {
    return AppProperties.getString('tasks.notify.sweep.cron', '*/5 * * * *')
  },
  enabled: true,
  runOnStartup: false,
  async execute() {
    const outcome = await service.sweep()

    if (outcome.sent > 0 || outcome.expired > 0 || outcome.failed > 0) {
      console.info(
        `Notifications: sent ${outcome.sent}, expired ${outcome.expired}, failed ${outcome.failed}` +
          (outcome.reason ? ` (${outcome.reason})` : '')
      )
    }

    // A send that failed is worth recording against the task, so it shows in
    // Settings, and, once this has been running a while, notifies about
    // itself through the system-fault path.
    if (outcome.failed > 0) throw new Error(outcome.reason ?? 'Some notifications could not be sent')
  }
}
