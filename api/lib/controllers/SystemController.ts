import { Controller } from '../core/Controller'
import { Get, Hidden, NoCache, Path, Post, Response, Route, SuccessResponse } from '../core/Decorators'
import { TaskStatus } from '../core/model/Task'
import { SystemEndpoints } from '../services/SystemEndpoints'

const endpoints = new SystemEndpoints()

/**
 * Service metadata and background-task control.
 *
 * Controllers stay thin: they declare the route, the status code and the
 * middleware, and hand straight off to an endpoint class. The logic lives in
 * services/SystemEndpoints.ts.
 */
@Route('api/system')
export class SystemController extends Controller {
  public constructor() {
    super()
  }

  /** Liveness probe for the UI, cheaper than /healthCheck, which hits the database. */
  @Get('ping')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getPing(): Promise<{ pong: true; timestamp: string }> {
    return endpoints.ping()
  }

  /** Version, platform and configuration summary. Shown on the Settings page. */
  @Get('info')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getInfo(): Promise<Record<string, unknown>> {
    return endpoints.info()
  }

  /** Schedule, last run and last error for every background task. */
  @Get('tasks')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getTasks(): Promise<TaskStatus[]> {
    return endpoints.taskStatus()
  }

  /** Run a background task now. */
  @Post('tasks/{name}/run')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such task')
  @NoCache()
  public async postRunTask(@Path('name') name: string): Promise<TaskStatus> {
    return endpoints.runTask(name)
  }

  @Get('routes')
  @SuccessResponse(200, 'OK')
  @NoCache()
  @Hidden()
  public async getRoutes(): Promise<Array<{ method: string; path: string; handler: string }>> {
    return endpoints.routes()
  }
}
