/**
 * A single health probe. Registered in health-checks/HealthCheckLoader.ts and
 * run by the /healthCheck endpoint.
 */
export interface HealthValidator {
  /** Short identifier shown in the response, e.g. 'database' */
  name: string
  /** A failing critical validator makes /healthCheck return 503 */
  critical: boolean
  validate(): Promise<HealthResult>
}

export interface HealthResult {
  healthy: boolean
  message?: string
  /** Anything useful for debugging: versions, row counts, last sync times */
  detail?: Record<string, unknown>
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'unhealthy'
  uptimeSeconds: number
  version: string
  timestamp: string
  checks: Array<HealthResult & { name: string; critical: boolean; durationMs: number }>
}
