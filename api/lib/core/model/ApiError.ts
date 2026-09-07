/**
 * Errors that carry an HTTP status.
 *
 * Endpoint classes throw these; the error middleware in ExpressServer turns
 * them into a JSON response. Anything else that escapes a handler is treated
 * as a 500 and logged, so internal details never reach the client.
 */
export class ApiError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly details?: unknown

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code ?? ApiError.defaultCodeFor(statusCode)
    this.details = details
    Object.setPrototypeOf(this, ApiError.prototype)
  }

  public static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, 'BAD_REQUEST', details)
  }

  public static notFound(message = 'Not Found', details?: unknown): ApiError {
    return new ApiError(404, message, 'NOT_FOUND', details)
  }

  public static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, message, 'CONFLICT', details)
  }

  public static unprocessable(message: string, details?: unknown): ApiError {
    return new ApiError(422, message, 'VALIDATION_FAILED', details)
  }

  public static badGateway(message: string, details?: unknown): ApiError {
    return new ApiError(502, message, 'UPSTREAM_FAILED', details)
  }

  public static unavailable(message: string, details?: unknown): ApiError {
    return new ApiError(503, message, 'UNAVAILABLE', details)
  }

  public static internal(message = 'Internal Server Error', details?: unknown): ApiError {
    return new ApiError(500, message, 'INTERNAL_ERROR', details)
  }

  public toPayload(): { message: string; code: string; details?: unknown } {
    return this.details === undefined
      ? { message: this.message, code: this.code }
      : { message: this.message, code: this.code, details: this.details }
  }

  private static defaultCodeFor(statusCode: number): string {
    switch (statusCode) {
      case 400:
        return 'BAD_REQUEST'
      case 401:
        return 'UNAUTHORIZED'
      case 403:
        return 'FORBIDDEN'
      case 404:
        return 'NOT_FOUND'
      case 409:
        return 'CONFLICT'
      case 422:
        return 'VALIDATION_FAILED'
      case 502:
        return 'UPSTREAM_FAILED'
      case 503:
        return 'UNAVAILABLE'
      default:
        return statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR'
    }
  }
}
