import * as os from 'os'
import { AppProperties } from '../core/AppProperties'
import { HealthService } from '../core/HealthService'
import { RouteManager } from '../core/RouteManager'
import { TaskManager } from '../core/TaskManager'
import { ApiError } from '../core/model/ApiError'
import { TaskStatus } from '../core/model/Task'

/**
 * Service-level endpoints: liveness, build and host info, and manual control
 * of the background refresh tasks (the "refresh now" buttons in Settings).
 */
export class SystemEndpoints {
  public async ping(): Promise<{ pong: true; timestamp: string }> {
    return { pong: true, timestamp: new Date().toISOString() }
  }

  public async info(): Promise<Record<string, unknown>> {
    return {
      name: 'family-dash-api',
      version: process.env.npm_package_version ?? '0.1.0',
      environment: process.env.NODE_ENV ?? 'development',
      timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      configSource: AppProperties.source(),
      node: process.version,
      // Useful when the same image runs on a Mac and on a Pi.
      platform: `${os.platform()}/${os.arch()}`,
      uptimeSeconds: Math.floor(process.uptime()),
      routes: RouteManager.registeredRoutes().length,
      healthChecks: HealthService.registered().map(validator => validator.name),
      tasks: TaskManager.names()
    }
  }

  public async taskStatus(): Promise<TaskStatus[]> {
    return TaskManager.status()
  }

  /**
   * Trigger a background task immediately. Returns its status once it
   * finishes, so the Settings page can report the outcome rather than just
   * "requested".
   */
  public async runTask(name: string): Promise<TaskStatus> {
    const status = await TaskManager.run(name)

    if (!status) {
      throw ApiError.notFound(`No task named '${name}'`, { available: TaskManager.names() })
    }

    return status
  }

  /** Every registered route. Handy when a UI call 404s and you want to know why. */
  public async routes(): Promise<Array<{ method: string; path: string; handler: string }>> {
    return RouteManager.registeredRoutes().map(route => ({
      method: route.method.toUpperCase(),
      path: route.path,
      handler: `${route.controller}.${route.handler}`
    }))
  }
}
