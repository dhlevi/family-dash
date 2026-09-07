import { Request, RequestHandler, Response } from 'express'
import { HealthService } from '../core/HealthService'
import { TaskManager } from '../core/TaskManager'
import { HealthValidator } from '../core/model/HealthValidator'

/**
 * Builds the `/healthCheck` handler from a set of validators.
 *
 * Returns 503 when a critical probe fails so `docker compose ps` and any
 * external monitor see the container as unhealthy; a degraded report (a
 * failing calendar feed, say) still answers 200 with the detail included.
 */
export function HealthValidators(...validators: HealthValidator[]): RequestHandler {
  HealthService.register(...validators)

  return async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
    const report = await HealthService.report()

    res.setHeader('Cache-Control', 'no-store')
    res.status(report.status === 'unhealthy' ? 503 : 200).json({
      ...report,
      tasks: TaskManager.status()
    })
  }
}
