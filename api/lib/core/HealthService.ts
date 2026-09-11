import { HealthReport, HealthResult, HealthValidator } from './model/HealthValidator'

/**
 * Runs the registered health probes and summarises them.
 *
 * Status is `ok` when everything passes, `unhealthy` when a probe marked
 * critical fails (the endpoint then answers 503, which is what the container
 * healthcheck watches), and `degraded` when only non-critical probes fail.
 * A broken calendar feed should show up in the report without making
 * docker restart the container.
 */
export class HealthService {
  private static validators: HealthValidator[] = []
  private static startedAt = Date.now()
  private static readonly TIMEOUT_MS = 5000

  private constructor() {
    /* static only */
  }

  public static register(...validators: HealthValidator[]): void {
    HealthService.validators.push(...validators)
  }

  public static registered(): HealthValidator[] {
    return [...HealthService.validators]
  }

  public static reset(): void {
    HealthService.validators = []
  }

  public static async report(): Promise<HealthReport> {
    const checks = await Promise.all(
      HealthService.validators.map(async validator => {
        const startedAt = Date.now()
        const result = await HealthService.runWithTimeout(validator)

        return {
          name: validator.name,
          critical: validator.critical,
          durationMs: Date.now() - startedAt,
          ...result
        }
      })
    )

    const criticalFailure = checks.some(check => check.critical && !check.healthy)
    const anyFailure = checks.some(check => !check.healthy)

    return {
      status: criticalFailure ? 'unhealthy' : anyFailure ? 'degraded' : 'ok',
      uptimeSeconds: Math.floor((Date.now() - HealthService.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      checks
    }
  }

  /**
   * A probe that hangs would hang the health endpoint, and a hung health
   * endpoint makes docker's healthcheck ambiguous rather than failing.
   */
  private static async runWithTimeout(validator: HealthValidator): Promise<HealthResult> {
    let timer: NodeJS.Timeout | undefined

    try {
      return await Promise.race([
        validator.validate(),
        new Promise<HealthResult>(resolve => {
          timer = setTimeout(
            () => resolve({ healthy: false, message: `Timed out after ${HealthService.TIMEOUT_MS}ms` }),
            HealthService.TIMEOUT_MS
          )
        })
      ])
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
