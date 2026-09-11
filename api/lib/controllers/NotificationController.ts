import { Controller } from '../core/Controller'
import { Body, Get, NoCache, Post, Response, Route, SuccessResponse } from '../core/Decorators'
import { NotificationEndpoints, type NotificationStatus } from '../services/NotificationEndpoints'
import type { SweepOutcome } from '../services/NotificationService'

const endpoints = new NotificationEndpoints()

/**
 * Push notifications.
 *
 * The dashboard knows a chore is overdue and that the bins go out tonight. Up
 * to now it had no way of telling anybody who was not standing in front of it.
 */
@Route('api/notifications')
export class NotificationController extends Controller {
  public constructor() {
    super()
  }

  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getStatus(): Promise<NotificationStatus> {
    return endpoints.status()
  }

  /** Generates any missing topics. Idempotent. */
  @Post('setup')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async postSetup(): Promise<NotificationStatus> {
    return endpoints.setup()
  }

  /** Sends one message, so somebody can check a phone is subscribed. */
  @Post('test')
  @SuccessResponse(204, 'Sent')
  @Response(400, 'No topic given')
  @Response(502, 'The notification server refused it')
  @NoCache()
  public async postTest(@Body() body: unknown): Promise<void> {
    return endpoints.test(body)
  }

  /** Runs a sweep now rather than waiting for the schedule. */
  @Post('sweep')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async postSweep(): Promise<SweepOutcome> {
    return endpoints.sweep()
  }
}
