import express from 'express'
import { AddressInfo } from 'net'
import { Server } from 'http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Controller } from '../../lib/core/Controller'
import { Body, Get, Path, Post, Query, Route, SuccessResponse } from '../../lib/core/Decorators'
import { RouteManager } from '../../lib/core/RouteManager'
import { ApiError } from '../../lib/core/model/ApiError'
import { errorHandler, notFoundHandler } from '../../lib/middleware/ErrorMiddleware'

/**
 * Exercises the ported decorator framework end to end: a decorated
 * controller, a real Express app and real HTTP requests. This is the piece
 * every other controller depends on, and its failure mode is silence — a
 * route that was never registered — so it is worth testing for real rather
 * than by inspecting metadata.
 */

let server: Server | null = null

/** Start an app whose router was built from whatever is currently registered. */
async function listen(): Promise<string> {
  const app = express()
  app.use(express.json())

  const router = express.Router()
  RouteManager.initializeRoutes(router)
  app.use(router)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return new Promise(resolve => {
    server = app.listen(0, () => {
      const { port } = server?.address() as AddressInfo
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

describe('RouteManager', () => {
  beforeEach(() => {
    RouteManager.reset()
  })

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server?.close(() => resolve()))
      server = null
    }
    RouteManager.reset()
  })

  it('registers routes from decorators and calls the handler', async () => {
    @Route('api/things')
    class ThingController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      @SuccessResponse(200, 'OK')
      public async list(): Promise<{ items: string[] }> {
        return { items: ['one', 'two'] }
      }

      @Get('{id}')
      public async byId(@Path() id: string): Promise<{ id: string }> {
        return { id }
      }
    }

    new ThingController()
    const base = await listen()

    const list = await fetch(`${base}/api/things`)
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual({ items: ['one', 'two'] })

    // `@Path()` with no explicit name resolves the parameter name from the
    // compiled function source.
    const single = await fetch(`${base}/api/things/abc-123`)
    await expect(single.json()).resolves.toEqual({ id: 'abc-123' })
  })

  it('coerces query parameters to their declared types', async () => {
    @Route('api/coerce')
    class CoerceController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      public async check(
        @Query('count') count?: number,
        @Query('flag') flag?: boolean,
        @Query('since') since?: Date,
        @Query('name') name?: string
      ): Promise<Record<string, unknown>> {
        return {
          count,
          countType: typeof count,
          flag,
          flagType: typeof flag,
          since: since?.toISOString(),
          isDate: since instanceof Date,
          name
        }
      }
    }

    new CoerceController()
    const base = await listen()

    const response = await fetch(`${base}/api/coerce?count=42&flag=yes&since=2026-01-15T00:00:00Z&name=hello`)
    await expect(response.json()).resolves.toMatchObject({
      count: 42,
      countType: 'number',
      flag: true,
      flagType: 'boolean',
      since: '2026-01-15T00:00:00.000Z',
      isDate: true,
      name: 'hello'
    })
  })

  it('omits absent optional query parameters rather than passing empty strings', async () => {
    @Route('api/optional')
    class OptionalController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      public async check(@Query('count') count?: number): Promise<{ provided: boolean }> {
        return { provided: count !== undefined }
      }
    }

    new OptionalController()
    const base = await listen()

    await expect((await fetch(`${base}/api/optional`)).json()).resolves.toEqual({ provided: false })
    await expect((await fetch(`${base}/api/optional?count=1`)).json()).resolves.toEqual({ provided: true })
  })

  it('rejects a query parameter that cannot be coerced', async () => {
    @Route('api/strict')
    class StrictController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      public async check(@Query('count') count?: number): Promise<{ count?: number }> {
        return { count }
      }
    }

    new StrictController()
    const base = await listen()

    const response = await fetch(`${base}/api/strict?count=banana`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('honours @SuccessResponse for the status code and 204s an empty return', async () => {
    @Route('api/status')
    class StatusController extends Controller {
      public constructor() {
        super()
      }

      @Post('created')
      @SuccessResponse(201, 'Created')
      public async create(@Body() body: { name: string }): Promise<{ name: string }> {
        return { name: body.name }
      }

      @Post('nothing')
      public async nothing(): Promise<void> {
        /* returns undefined */
      }
    }

    new StatusController()
    const base = await listen()

    const created = await fetch(`${base}/api/status/created`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'kettle' })
    })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({ name: 'kettle' })

    const empty = await fetch(`${base}/api/status/nothing`, { method: 'POST' })
    expect(empty.status).toBe(204)
  })

  it('maps a thrown ApiError onto its status code', async () => {
    @Route('api/errors')
    class ErrorController extends Controller {
      public constructor() {
        super()
      }

      @Get('missing')
      public async missing(): Promise<never> {
        throw ApiError.notFound('No such thing', { id: 'nope' })
      }

      @Get('boom')
      public async boom(): Promise<never> {
        throw new Error('internal detail that must not leak')
      }
    }

    new ErrorController()
    const base = await listen()

    const missing = await fetch(`${base}/api/errors/missing`)
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({
      message: 'No such thing',
      code: 'NOT_FOUND',
      details: { id: 'nope' }
    })

    const boom = await fetch(`${base}/api/errors/boom`)
    expect(boom.status).toBe(500)
    const payload = await boom.json()
    expect(payload).toEqual({ message: 'Internal Server Error', code: 'INTERNAL_ERROR' })
    expect(JSON.stringify(payload)).not.toContain('internal detail')
  })

  it('fails startup when a decorated controller was never instantiated', () => {
    @Route('api/forgotten')
    class ForgottenController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      public async list(): Promise<string[]> {
        return []
      }
    }

    // Deliberately not instantiated. Referencing the class keeps the linter
    // quiet about an unused declaration.
    expect(ForgottenController.name).toBe('ForgottenController')
    expect(() => RouteManager.initializeRoutes(express.Router())).toThrow(/never instantiated/)
  })

  it('fails startup when an endpoint has no verb decorator', () => {
    @Route('api/verbless')
    class VerblessController extends Controller {
      public constructor() {
        super()
      }

      @SuccessResponse(200, 'OK')
      public async list(): Promise<string[]> {
        return []
      }
    }

    new VerblessController()
    expect(() => RouteManager.initializeRoutes(express.Router())).toThrow(/missing an HTTP verb/)
  })

  it('normalises the joined controller and endpoint paths', async () => {
    @Route('api/nested/')
    class NestedController extends Controller {
      public constructor() {
        super()
      }

      @Get('/deep//path/')
      public async deep(): Promise<{ ok: true }> {
        return { ok: true }
      }
    }

    new NestedController()
    const base = await listen()

    expect(RouteManager.registeredRoutes()[0]?.path).toBe('/api/nested/deep/path')
    expect((await fetch(`${base}/api/nested/deep/path`)).status).toBe(200)
  })

  it('returns a JSON 404 for an unmatched route', async () => {
    @Route('api/present')
    class PresentController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      public async list(): Promise<string[]> {
        return []
      }
    }

    new PresentController()
    const base = await listen()

    const response = await fetch(`${base}/api/absent`)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' })
  })
})
