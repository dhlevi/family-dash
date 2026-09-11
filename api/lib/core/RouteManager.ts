import 'reflect-metadata'
import { Request, RequestHandler, Response, Router } from 'express'
import { ApiError } from './model/ApiError'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head'

/** Where a handler argument is read from on the incoming request. */
export type ParamSource = 'path' | 'query' | 'body' | 'header' | 'request' | 'response' | 'file' | 'files'

interface ParamMeta {
  index: number
  source: ParamSource
  /** Explicit name from the decorator, or resolved from the parameter name at startup */
  name?: string
  required: boolean
}

interface ResponseMeta {
  code: number
  description?: string
}

interface EndpointMeta {
  property: string
  route: string | null
  method: HttpMethod | null
  successCode: number
  successDescription?: string
  responses: ResponseMeta[]
  middleware: RequestHandler[]
  params: ParamMeta[]
  hidden: boolean
}

interface ControllerMeta {
  name: string
  prototype: any
  baseRoute: string | null
  instance: any | null
  endpoints: Map<string, EndpointMeta>
}

export interface RegisteredRoute {
  controller: string
  handler: string
  method: HttpMethod
  path: string
  successCode: number
  params: ParamMeta[]
  responses: ResponseMeta[]
  hidden: boolean
}

/**
 * Decorator-driven route registration, ported from
 * dhlevi/express-ts-api-boilerplate.
 *
 * Decorators on a controller record metadata here at import time. Because
 * TypeScript evaluates method decorators before the class decorator, and
 * bottom-up within a method, nothing is resolved eagerly. Everything is
 * keyed on the controller prototype and stitched together when
 * `initializeRoutes` runs.
 *
 * A controller only produces routes once all three of these have happened:
 *   1. `@Route('api/thing')` on the class      -> baseRoute
 *   2. `@Get('...')` etc. on its methods       -> endpoints
 *   3. the class is instantiated in Routes.ts  -> instance (via Controller's
 *      constructor, which self-registers)
 * A controller missing any of them is reported at startup rather than
 * silently serving nothing, which is the failure mode the original template
 * warns about.
 */
export class RouteManager {
  private static controllers = new Map<any, ControllerMeta>()
  private static routes: RegisteredRoute[] = []
  private static initialized = false

  private constructor() {
    /* static only */
  }

  // -- registration (called by decorators) ----------------------------------

  /** `@Route()` records the controller's base path. Receives the constructor. */
  public static registerController(constructor: any, route: string): void {
    const meta = RouteManager.metaFor(constructor.prototype, constructor.name)
    meta.baseRoute = route
  }

  /** Called from the Controller base constructor so the manager has something to invoke. */
  public static registerInstance(instance: any): void {
    const prototype = Object.getPrototypeOf(instance)
    const meta = RouteManager.metaFor(prototype, instance.constructor?.name ?? 'UnknownController')
    meta.instance = instance
  }

  /**
   * `@Get`/`@Post`/... and `@SuccessResponse` both land here. The response
   * decorators pass null for route and method so they can annotate an
   * endpoint without clobbering the verb that registered it.
   */
  public static registerEndpoint(
    prototype: any,
    property: string,
    route: string | null,
    method: HttpMethod | null,
    successCode?: string | number,
    successDescription?: string
  ): void {
    const endpoint = RouteManager.endpointFor(prototype, property)

    if (route !== null) endpoint.route = route
    if (method !== null) endpoint.method = method
    if (successCode !== undefined) {
      const parsed = Number(successCode)
      if (!Number.isNaN(parsed)) endpoint.successCode = parsed
    }
    if (successDescription !== undefined) endpoint.successDescription = successDescription
  }

  /** `@Response(code, description)` documentation only, surfaced in the OpenAPI spec. */
  public static registerResponse(prototype: any, property: string, code: number, description?: string): void {
    const endpoint = RouteManager.endpointFor(prototype, property)
    if (!endpoint.responses.some(response => response.code === code)) {
      endpoint.responses.push({ code, description })
    }
  }

  /** `@NoCache`, `@Cors`, the multer upload decorators. */
  public static registerEndpointMiddleware(
    prototype: any,
    property: string,
    middleware: RequestHandler | RequestHandler[]
  ): void {
    const endpoint = RouteManager.endpointFor(prototype, property)
    const handlers = Array.isArray(middleware) ? middleware : [middleware]
    // Decorators evaluate bottom-up, so unshifting restores the order the
    // decorators were written in.
    endpoint.middleware.unshift(...handlers)
  }

  /** `@Path`, `@Query`, `@Body`, `@Header`, `@Req`, `@UploadedFile`. */
  public static registerParameter(
    prototype: any,
    property: string,
    index: number,
    source: ParamSource,
    name?: string,
    required?: boolean
  ): void {
    const endpoint = RouteManager.endpointFor(prototype, property)
    const isRequired = required ?? (source === 'path' || source === 'body')

    const existing = endpoint.params.findIndex(param => param.index === index)
    const meta: ParamMeta = { index, source, name, required: isRequired }

    if (existing >= 0) endpoint.params[existing] = meta
    else endpoint.params.push(meta)
  }

  /** `@Hidden()` keep an endpoint out of the generated OpenAPI spec. */
  public static registerHidden(prototype: any, property: string): void {
    RouteManager.endpointFor(prototype, property).hidden = true
  }

  // -- wiring ---------------------------------------------------------------

  /**
   * Bind every fully-registered endpoint onto the router. Call once, after
   * all controllers have been instantiated.
   */
  public static initializeRoutes(router: Router): RegisteredRoute[] {
    if (RouteManager.initialized) {
      console.warn('initializeRoutes called more than once; ignoring the repeat call')
      return RouteManager.routes
    }

    const problems: string[] = []

    for (const meta of RouteManager.controllers.values()) {
      if (meta.baseRoute === null) {
        problems.push(`${meta.name} has endpoints but no @Route() decorator: no routes registered`)
        continue
      }
      if (meta.instance === null) {
        problems.push(`${meta.name} is decorated but never instantiated in routes/Routes.ts: no routes registered`)
        continue
      }

      for (const endpoint of meta.endpoints.values()) {
        if (endpoint.route === null || endpoint.method === null) {
          problems.push(`${meta.name}.${endpoint.property} is missing an HTTP verb decorator (@Get, @Post, ...): no routes registered`)
          continue
        }

        RouteManager.resolveParameterNames(meta, endpoint)

        const path = RouteManager.joinPaths(meta.baseRoute, endpoint.route)
        const handler = RouteManager.buildHandler(meta, endpoint)

        router[endpoint.method](path, ...endpoint.middleware, handler)

        RouteManager.routes.push({
          controller: meta.name,
          handler: endpoint.property,
          method: endpoint.method,
          path,
          successCode: endpoint.successCode,
          params: endpoint.params,
          responses: endpoint.responses,
          hidden: endpoint.hidden
        })

        console.info(`  ${endpoint.method.toUpperCase().padEnd(6)} ${path}  -> ${meta.name}.${endpoint.property}`)
      }
    }

    if (problems.length > 0) {
      // These are always developer mistakes and always silent at runtime,
      // so fail the boot rather than serve a half-wired API.
      throw new Error(`Route registration failed:\n  - ${problems.join('\n  - ')}`)
    }

    RouteManager.initialized = true
    console.info(`Registered ${RouteManager.routes.length} route(s)`)

    return RouteManager.routes
  }

  public static registeredRoutes(): RegisteredRoute[] {
    return [...RouteManager.routes]
  }

  /** Test-only: drop all registration state. */
  public static reset(): void {
    RouteManager.controllers.clear()
    RouteManager.routes = []
    RouteManager.initialized = false
  }

  // -- internals ------------------------------------------------------------

  private static metaFor(prototype: any, name: string): ControllerMeta {
    let meta = RouteManager.controllers.get(prototype)

    if (!meta) {
      meta = { name, prototype, baseRoute: null, instance: null, endpoints: new Map() }
      RouteManager.controllers.set(prototype, meta)
    } else if (meta.name === 'UnknownController' || !meta.name) {
      meta.name = name
    }

    return meta
  }

  private static endpointFor(prototype: any, property: string): EndpointMeta {
    const meta = RouteManager.metaFor(prototype, prototype?.constructor?.name ?? 'UnknownController')
    let endpoint = meta.endpoints.get(property)

    if (!endpoint) {
      endpoint = {
        property,
        route: null,
        method: null,
        successCode: 200,
        responses: [],
        middleware: [],
        params: [],
        hidden: false
      }
      meta.endpoints.set(property, endpoint)
    }

    return endpoint
  }

  private static joinPaths(base: string, route: string): string {
    const joined = `/${base}/${route}`.replace(/\/{2,}/g, '/')
    return joined.length > 1 ? joined.replace(/\/+$/, '') : joined
  }

  /**
   * `@Path() id: string` gives no name to work with, so fall back to reading
   * the parameter name out of the compiled function source. TypeScript does
   * not mangle parameter names, so this is reliable, but destructured or
   * otherwise unreadable parameters are rejected at startup with a message
   * telling the author to name the parameter explicitly.
   */
  private static resolveParameterNames(meta: ControllerMeta, endpoint: EndpointMeta): void {
    const needsName = endpoint.params.filter(param => !param.name && ['path', 'query', 'header'].includes(param.source))
    if (needsName.length === 0) return

    const fn = meta.prototype[endpoint.property]
    const names = RouteManager.parameterNames(fn)

    for (const param of needsName) {
      const resolved = names[param.index]
      if (!resolved) {
        throw new Error(
          `Cannot resolve the name of parameter ${param.index} on ${meta.name}.${endpoint.property}. ` +
            `Name it explicitly, e.g. @${param.source === 'path' ? 'Path' : 'Query'}('myParam').`
        )
      }
      param.name = resolved
    }
  }

  private static parameterNames(fn: unknown): string[] {
    if (typeof fn !== 'function') return []

    const source = fn.toString()
    const open = source.indexOf('(')
    if (open < 0) return []

    // Walk to the matching close paren so default values containing parens
    // (e.g. `page = Number(1)`) do not truncate the list.
    let depth = 0
    let close = -1
    for (let i = open; i < source.length; i++) {
      const char = source[i]
      if (char === '(') depth++
      else if (char === ')') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close < 0) return []

    const params = source.slice(open + 1, close)
    if (params.trim().length === 0) return []

    return RouteManager.splitTopLevel(params).map(part =>
      part
        .replace(/=.*$/s, '')
        .replace(/:.*$/s, '')
        .replace(/\?/g, '')
        .replace(/^\.\.\./, '')
        .trim()
    )
  }

  /** Split a parameter list on commas that are not nested inside brackets. */
  private static splitTopLevel(input: string): string[] {
    const parts: string[] = []
    let depth = 0
    let current = ''

    for (const char of input) {
      if ('([{'.includes(char)) depth++
      else if (')]}'.includes(char)) depth--

      if (char === ',' && depth === 0) {
        parts.push(current)
        current = ''
      } else {
        current += char
      }
    }
    if (current.trim().length > 0) parts.push(current)

    return parts
  }

  private static buildHandler(meta: ControllerMeta, endpoint: EndpointMeta): RequestHandler {
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', meta.prototype, endpoint.property) ?? []
    const ordered = [...endpoint.params].sort((a, b) => a.index - b.index)
    const arity = ordered.length > 0 ? Math.max(...ordered.map(param => param.index)) + 1 : 0

    return async (req: Request, res: Response, next) => {
      try {
        const args = new Array(arity)
        for (const param of ordered) {
          args[param.index] = RouteManager.resolveArgument(param, paramTypes[param.index], req, res, meta, endpoint)
        }

        const result = await meta.instance[endpoint.property](...args)

        // A handler that took the raw response and wrote to it directly owns
        // the reply; do not try to send a second one.
        if (res.headersSent) return

        if (result === undefined || result === null) {
          res.status(204).end()
          return
        }

        res.status(endpoint.successCode).json(result)
      } catch (error) {
        next(error)
      }
    }
  }

  private static resolveArgument(
    param: ParamMeta,
    declaredType: any,
    req: Request,
    res: Response,
    meta: ControllerMeta,
    endpoint: EndpointMeta
  ): unknown {
    const label = `${meta.name}.${endpoint.property}`

    switch (param.source) {
      case 'request':
        return req
      case 'response':
        return res
      case 'file':
        return (req as any).file
      case 'files':
        return (req as any).files
      case 'body': {
        const body = req.body
        if (
          param.required &&
          (body === undefined || (typeof body === 'object' && Object.keys(body ?? {}).length === 0))
        ) {
          throw ApiError.badRequest(`A request body is required by ${label}`)
        }
        return body
      }
      case 'path':
      case 'query':
      case 'header': {
        const raw = RouteManager.rawValue(param, req)
        if (raw === undefined || raw === '') {
          if (param.required) {
            throw ApiError.badRequest(`Missing required ${param.source} parameter '${param.name}'`)
          }
          return undefined
        }
        return RouteManager.coerce(raw, declaredType, param)
      }
      default:
        return undefined
    }
  }

  private static rawValue(param: ParamMeta, req: Request): unknown {
    const name = param.name as string

    if (param.source === 'path') return (req.params as Record<string, string>)[name]
    if (param.source === 'query') return (req.query as Record<string, unknown>)[name]

    return req.headers[name.toLowerCase()]
  }

  /**
   * Path, query and header values always arrive as strings. `emitDecoratorMetadata`
   * gives us the declared parameter type, so the handler receives the number,
   * boolean or Date it asked for instead of a string that looks like one.
   */
  private static coerce(raw: unknown, declaredType: any, param: ParamMeta): unknown {
    if (declaredType === Number) {
      const value = Number(Array.isArray(raw) ? raw[0] : raw)
      if (Number.isNaN(value)) {
        throw ApiError.badRequest(`Parameter '${param.name}' must be a number, received '${String(raw)}'`)
      }
      return value
    }

    if (declaredType === Boolean) {
      const value = String(Array.isArray(raw) ? raw[0] : raw)
        .trim()
        .toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(value)) return true
      if (['false', '0', 'no', 'off'].includes(value)) return false
      throw ApiError.badRequest(`Parameter '${param.name}' must be a boolean, received '${String(raw)}'`)
    }

    if (declaredType === Date) {
      const value = new Date(String(Array.isArray(raw) ? raw[0] : raw))
      if (Number.isNaN(value.getTime())) {
        throw ApiError.badRequest(`Parameter '${param.name}' must be an ISO date, received '${String(raw)}'`)
      }
      return value
    }

    if (declaredType === Array) {
      return Array.isArray(raw) ? raw : [raw]
    }

    if (declaredType === String) {
      return String(Array.isArray(raw) ? raw[0] : raw)
    }

    return raw
  }
}
