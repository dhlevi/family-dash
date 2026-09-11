import { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import { ZodError } from 'zod'
import { ApiError } from '../core/model/ApiError'

/**
 * Terminal error handler.
 *
 * Everything a handler throws arrives here. Express 5 forwards rejected
 * promises automatically, so async handlers need no try/catch of their own.
 * Known error shapes become useful status codes; anything else is logged in
 * full and reported as a bare 500, so internals never reach the client.
 */
export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): Response | void {
  if (res.headersSent) {
    // The response is already on the wire; all we can do is let Express
    // tear down the connection.
    return next(error)
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) console.error(`${req.method} ${req.path} -> ${error.statusCode}`, error)
    else console.warn(`${req.method} ${req.path} -> ${error.statusCode}: ${error.message}`)

    return res.status(error.statusCode).json(error.toPayload())
  }

  if (error instanceof ZodError) {
    console.warn(`${req.method} ${req.path} -> 422 validation failed`, error.issues)
    return res.status(422).json({
      message: 'Validation failed',
      code: 'VALIDATION_FAILED',
      details: error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    })
  }

  if (error instanceof MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'The uploaded file is larger than the configured limit'
        : `Upload rejected: ${error.message}`

    console.warn(`${req.method} ${req.path} -> 400 ${error.code}`)
    return res.status(400).json({ message, code: error.code })
  }

  const fromDatabase = asDatabaseError(error)
  if (fromDatabase) {
    console.warn(`${req.method} ${req.path} -> ${fromDatabase.statusCode}: ${fromDatabase.message}`)
    return res.status(fromDatabase.statusCode).json(fromDatabase.toPayload())
  }

  if (isBodyParserError(error)) {
    console.warn(`${req.method} ${req.path} -> 400 malformed body`)
    return res.status(400).json({ message: 'Malformed request body', code: 'BAD_REQUEST' })
  }

  console.error(`Unhandled error on ${req.method} ${req.path}`, error)
  return res.status(500).json({ message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
}

/** Express 404 fallback, registered after every route. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    message: `No route matches ${req.method} ${req.path}`,
    code: 'NOT_FOUND'
  })
}

/**
 * Postgres errors that are really the client's doing.
 *
 * Without this, asking for `/api/drawings/not-a-uuid` reaches the query, and
 * Postgres refusing to cast the text to a uuid surfaces as a bare 500. The same goes for the
 * constraint violations: the schema rejecting a value says something about
 * the request, not about the server.
 *
 * Only these are translated. Anything else from the database really is ours
 * to fix, and should stay a logged 500.
 */
function asDatabaseError(error: unknown): ApiError | null {
  if (typeof error !== 'object' || error === null) return null

  const candidate = error as { code?: unknown; severity?: unknown; routine?: unknown }
  // `severity` and `routine` are set by pg on a real server error, which
  // keeps this from matching anything else that happens to carry a `code`.
  if (typeof candidate.code !== 'string') return null
  if (candidate.severity === undefined && candidate.routine === undefined) return null

  switch (candidate.code) {
    case '22P02': // invalid_text_representation usually a malformed uuid
    case '22003': // numeric_value_out_of_range
    case '22007': // invalid_datetime_format
      return ApiError.badRequest('One of the values in the request is not in a form the database accepts')
    case '23505': // unique_violation
      return ApiError.conflict('That already exists')
    case '23503': // foreign_key_violation
      return ApiError.unprocessable('That refers to something which does not exist')
    case '23502': // not_null_violation
      return ApiError.unprocessable('A required value was missing')
    default:
      return null
  }
}

/** body-parser signals malformed JSON and oversized payloads this way. */
function isBodyParserError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { type?: string; status?: number; statusCode?: number }
  const status = candidate.status ?? candidate.statusCode

  return (
    candidate.type === 'entity.parse.failed' ||
    candidate.type === 'entity.too.large' ||
    (status !== undefined && status >= 400 && status < 500 && candidate.type !== undefined)
  )
}
