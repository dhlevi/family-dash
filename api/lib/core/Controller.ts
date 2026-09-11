import { RouteManager } from './RouteManager'

/**
 * Base class for every controller.
 *
 * The constructor self-registers the instance with the RouteManager, which is
 * what lets `new TaskController()` in routes/Routes.ts be all the wiring a
 * controller needs.
 *
 * Controllers are instantiated once and shared across requests, so they hold
 * no per-request state.  To vary the status code, use `@SuccessResponse` for
 * the happy path and throw an `ApiError` otherwise; to write a response directly, take `@Res()`.
 */
export abstract class Controller {
  protected constructor() {
    RouteManager.registerInstance(this)
  }
}
