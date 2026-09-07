import * as cron from 'node-cron'
import { Task, TaskStatus } from './model/Task'

interface TrackedTask {
  task: Task
  scheduled: cron.ScheduledTask | null
  running: boolean
  lastRunAt: Date | null
  lastDurationMs: number | null
  lastError: string | null
  runCount: number
  errorCount: number
}

/**
 * Registry for the background refresh jobs.
 *
 * These are what keep the dashboard fast and offline-tolerant: calendar
 * feeds, news and weather are pulled on a schedule into Postgres, and the UI
 * only ever reads the database. If the network drops, or a feed starts
 * failing, the last good data stays on the wall.
 *
 * Failures are recorded rather than thrown — one broken feed must not stop
 * the scheduler or crash the service — and surface in `/healthCheck`.
 */
export class TaskManager {
  private static tasks = new Map<string, TrackedTask>()

  private constructor() {
    /* static only */
  }

  public static register(...tasks: Task[]): void {
    for (const task of tasks) {
      if (TaskManager.tasks.has(task.name)) {
        console.warn(`Task '${task.name}' is already registered; ignoring the duplicate`)
        continue
      }

      TaskManager.tasks.set(task.name, {
        task,
        scheduled: null,
        running: false,
        lastRunAt: null,
        lastDurationMs: null,
        lastError: null,
        runCount: 0,
        errorCount: 0
      })
    }
  }

  /** Schedule everything registered and enabled. */
  public static async start(): Promise<void> {
    for (const tracked of TaskManager.tasks.values()) {
      const { task } = tracked

      if (!task.enabled) {
        console.info(`Task '${task.name}' is disabled; not scheduling`)
        continue
      }

      if (!cron.validate(task.cron)) {
        console.error(`Task '${task.name}' has an invalid cron expression ('${task.cron}'); not scheduling`)
        tracked.lastError = `Invalid cron expression: ${task.cron}`
        continue
      }

      tracked.scheduled = cron.schedule(task.cron, () => {
        void TaskManager.run(task.name)
      })

      console.info(`Scheduled task '${task.name}' with cron '${task.cron}'`)
    }

    // Startup runs happen after everything is scheduled, and sequentially, so
    // a Pi does not try to fetch every feed at once on boot.
    for (const tracked of TaskManager.tasks.values()) {
      if (tracked.task.enabled && tracked.task.runOnStartup) {
        await TaskManager.run(tracked.task.name)
      }
    }
  }

  /**
   * Run a task now, outside its schedule. Used by the startup pass and by the
   * "refresh now" buttons in Settings.
   */
  public static async run(name: string): Promise<TaskStatus | null> {
    const tracked = TaskManager.tasks.get(name)
    if (!tracked) {
      console.warn(`Asked to run unknown task '${name}'`)
      return null
    }

    if (tracked.running) {
      console.warn(`Task '${name}' is still running from a previous trigger; skipping this one`)
      return TaskManager.statusOf(tracked)
    }

    tracked.running = true
    const startedAt = Date.now()

    try {
      await tracked.task.execute()
      tracked.lastError = null
      tracked.runCount++
      console.info(`Task '${name}' completed in ${Date.now() - startedAt}ms`)
    } catch (error) {
      tracked.errorCount++
      tracked.lastError = error instanceof Error ? error.message : String(error)
      // Deliberately swallowed: a failing feed records its error and the
      // schedule carries on.
      console.error(`Task '${name}' failed`, error)
    } finally {
      tracked.running = false
      tracked.lastRunAt = new Date()
      tracked.lastDurationMs = Date.now() - startedAt
    }

    return TaskManager.statusOf(tracked)
  }

  public static status(): TaskStatus[] {
    return [...TaskManager.tasks.values()].map(tracked => TaskManager.statusOf(tracked))
  }

  public static names(): string[] {
    return [...TaskManager.tasks.keys()]
  }

  /** Stop every schedule. Called during shutdown. */
  public static clearTasks(): void {
    for (const tracked of TaskManager.tasks.values()) {
      tracked.scheduled?.stop()
      tracked.scheduled = null
    }
    console.info('Cleared all scheduled tasks')
  }

  public static reset(): void {
    TaskManager.clearTasks()
    TaskManager.tasks.clear()
  }

  private static statusOf(tracked: TrackedTask): TaskStatus {
    return {
      name: tracked.task.name,
      cron: tracked.task.cron,
      enabled: tracked.task.enabled,
      running: tracked.running,
      lastRunAt: tracked.lastRunAt?.toISOString() ?? null,
      lastDurationMs: tracked.lastDurationMs,
      lastError: tracked.lastError,
      runCount: tracked.runCount,
      errorCount: tracked.errorCount
    }
  }
}
