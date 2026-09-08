import type { NextFunction, Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { ApiError } from '../../lib/core/model/ApiError'
import { errorHandler } from '../../lib/middleware/ErrorMiddleware'

/**
 * The wall display has no console and nobody debugging it, so the status a
 * failure reports matters: a 500 says "the server is broken and someone
 * should look", and using it for a request that was simply malformed sends
 * whoever eventually reads the logs looking in the wrong place.
 */
function capture() {
  const sent: { status?: number; body?: unknown } = {}
  const res = {
    headersSent: false,
    status(code: number) {
      sent.status = code
      return this
    },
    json(body: unknown) {
      sent.body = body
      return this
    }
  } as unknown as Response

  return { res, sent }
}

const request = { method: 'GET', path: '/api/drawings/not-a-uuid' } as Request
const next = vi.fn() as unknown as NextFunction

/** A pg DatabaseError carries an SQLSTATE plus these server fields. */
const databaseError = (code: string) =>
  Object.assign(new Error('database says no'), { code, severity: 'ERROR', routine: 'string_to_uuid' })

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('errorHandler', () => {
  it('passes an ApiError through with its own status', () => {
    const { res, sent } = capture()
    errorHandler(ApiError.notFound("No drawing with id 'x'"), request, res, next)

    expect(sent.status).toBe(404)
    expect(sent.body).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('reports a failed zod parse as a validation error, listing the fields', () => {
    const { res, sent } = capture()
    const failure = new ZodError([{ code: 'custom', path: ['strokes', 0, 'colour'], message: 'Must be a hex colour' }])

    errorHandler(failure, request, res, next)

    expect(sent.status).toBe(422)
    expect(sent.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'strokes.0.colour', message: 'Must be a hex colour' }]
    })
  })

  it('treats an id Postgres cannot read as a bad request, not a server fault', () => {
    const { res, sent } = capture()
    // What `GET /api/drawings/not-a-uuid` produces: the route matches, the
    // query runs, and Postgres refuses to cast the text to a uuid.
    errorHandler(databaseError('22P02'), request, res, next)

    expect(sent.status).toBe(400)
  })

  it('maps the constraint violations a request can cause', () => {
    const cases: [string, number][] = [
      ['23505', 409],
      ['23503', 422],
      ['23502', 422],
      ['22003', 400],
      ['22007', 400]
    ]

    for (const [code, status] of cases) {
      const { res, sent } = capture()
      errorHandler(databaseError(code), request, res, next)
      expect(sent.status, `SQLSTATE ${code}`).toBe(status)
    }
  })

  it('still reports a genuine database fault as a 500', () => {
    const { res, sent } = capture()
    // 42703 is undefined_column — a query we wrote wrongly, which is ours.
    errorHandler(databaseError('42703'), request, res, next)

    expect(sent.status).toBe(500)
    expect(sent.body).toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  it('does not mistake an unrelated error carrying a code for a database one', () => {
    const { res, sent } = capture()
    errorHandler(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), request, res, next)

    expect(sent.status).toBe(500)
  })

  it('keeps internal detail out of a 500', () => {
    const { res, sent } = capture()
    errorHandler(new Error('password=hunter2 at /app/lib/secret.ts:12'), request, res, next)

    expect(JSON.stringify(sent.body)).not.toContain('hunter2')
    expect(sent.body).toEqual({ message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
  })

  it('hands the error on when the response has already started', () => {
    const { res, sent } = capture()
    ;(res as { headersSent: boolean }).headersSent = true
    const forward = vi.fn() as unknown as NextFunction
    const failure = new Error('too late')

    errorHandler(failure, request, res, forward)

    expect(forward).toHaveBeenCalledWith(failure)
    expect(sent.status).toBeUndefined()
  })
})
