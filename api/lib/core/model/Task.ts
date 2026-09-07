/**
 * A background job managed by TaskManager.
 *
 * These keep the dashboard responsive: external feeds are pulled on a
 * schedule into Postgres, so a page load reads the database instead of
 * waiting on somebody else's API.
 */
export interface Task {
  /** Unique name, used for logging and for the /healthCheck task report */
  name: string
  /** Standard five-field cron expression */
  cron: string
  enabled: boolean
  /** Run once at startup as well as on the schedule */
  runOnStartup?: boolean
  execute(): Promise<void>
}

export interface TaskStatus {
  name: string
  cron: string
  enabled: boolean
  running: boolean
  lastRunAt: string | null
  lastDurationMs: number | null
  lastError: string | null
  runCount: number
  errorCount: number
}
