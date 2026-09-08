import cors from 'cors'
import type { RequestHandler } from 'express'
import multer from 'multer'
import { HttpMethod, RouteManager } from './RouteManager'
import { noCache } from '../middleware/NoCacheMiddleware'

/**
 * Decorators used by the controllers.
 *
 * Ported from dhlevi/express-ts-api-boilerplate, with the tsoa dependency
 * dropped: the OpenAPI document is generated at runtime from the
 * RouteManager's own registry (see OpenApiGenerator) rather than by a
 * build-time AST pass, so these are plain decorators with no counterpart
 * elsewhere to keep in sync.
 *
 * Every endpoint method must be `public async` and must carry a verb
 * decorator, otherwise startup fails with an explanatory error.
 */

// -- class ------------------------------------------------------------------

/**
 * Base route for a controller, relative to the application root.
 * An empty path mounts the controller at the top level.
 */
export function Route(path: string): ClassDecorator {
  return function routeDecorator(target: any) {
    RouteManager.registerController(target, `/${path}`.replace(/\/{2,}/g, '/').trim())
    return target
  }
}

// -- verbs ------------------------------------------------------------------

function verb(method: HttpMethod) {
  return function (path: string): MethodDecorator {
    return function verbDecorator(target: any, property: any, descriptor: any) {
      // `{id}` is accepted for familiarity with the tsoa-style templates and
      // rewritten to Express's `:id` form.
      const route = `/${path}`.replace(/\{/g, ':').replace(/\}/g, '')
      RouteManager.registerEndpoint(target, String(property), route.replace(/\/{2,}/g, '/').trim(), method)
      return descriptor
    }
  }
}

export const Get = verb('get')
export const Post = verb('post')
export const Put = verb('put')
export const Patch = verb('patch')
export const Delete = verb('delete')
export const Options = verb('options')
export const Head = verb('head')

// -- parameters -------------------------------------------------------------

/** A path segment, e.g. `@Get('tasks/{id}')` with `@Path() id: string`. */
export function Path(name?: string): ParameterDecorator {
  return function pathDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'path', name, true)
  }
}

/** A query string value. Optional unless `required` is passed. */
export function Query(name?: string, required = false): ParameterDecorator {
  return function queryDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'query', name, required)
  }
}

/**
 * The parsed request body. Required unless `required` is passed as false.
 *
 * An upload endpoint whose form carries files and no text fields legitimately
 * arrives with an empty body, so those declare `@Body(false)`.
 */
export function Body(required = true): ParameterDecorator {
  return function bodyDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'body', undefined, required)
  }
}

/** A request header, matched case-insensitively. */
export function Header(name?: string, required = false): ParameterDecorator {
  return function headerDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'header', name, required)
  }
}

/** Escape hatch for the raw Express request. */
export function Req(): ParameterDecorator {
  return function reqDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'request')
  }
}

/**
 * Escape hatch for the raw Express response. A handler that writes to it owns
 * the reply — used for streaming file downloads.
 */
export function Res(): ParameterDecorator {
  return function resDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'response')
  }
}

/** The single file accepted by `@UploadSingle`. */
export function UploadedFile(): ParameterDecorator {
  return function uploadedFileDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'file')
  }
}

/** The files accepted by `@UploadArray` or `@MultiPartFormMixed`. */
export function UploadedFiles(): ParameterDecorator {
  return function uploadedFilesDecorator(target: any, property: any, index: number) {
    RouteManager.registerParameter(target, String(property), index, 'files')
  }
}

// -- documentation ----------------------------------------------------------

/** The expected success status. Also sets the status the handler replies with. */
export function SuccessResponse(code: string | number, description?: string): MethodDecorator {
  return function successResponseDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpoint(target, String(property), null, null, code, description)
    return descriptor
  }
}

/** An additional documented response, for the generated OpenAPI spec. */
export function Response(code: string | number, description?: string): MethodDecorator {
  return function responseDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerResponse(target, String(property), Number(code), description)
    return descriptor
  }
}

/** Keep an endpoint out of the generated OpenAPI spec. */
export function Hidden(): MethodDecorator {
  return function hiddenDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerHidden(target, String(property))
    return descriptor
  }
}

// -- middleware -------------------------------------------------------------

/**
 * Send no-store cache headers. Worth applying to anything the dashboard
 * polls, so a proxy or the browser never pins stale data on the wall display.
 */
export function NoCache(): MethodDecorator {
  return function noCacheDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(target, String(property), noCache)
    return descriptor
  }
}

/** Per-endpoint CORS. */
export function Cors(options?: cors.CorsOptions): MethodDecorator {
  return function corsDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(target, String(property), cors(options))
    return descriptor
  }
}

/** Attach arbitrary Express middleware to a single endpoint. */
export function Middleware(...handlers: any[]): MethodDecorator {
  return function middlewareDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(target, String(property), handlers)
    return descriptor
  }
}

// -- uploads ----------------------------------------------------------------

/**
 * Upload options, or a function returning them.
 *
 * The function form exists because a decorator runs when its module is
 * imported, and the controllers are imported through the route table before
 * `AppProperties.initialize()` has read application.properties. A limit
 * taken from configuration at decoration time would therefore always be the
 * hard-coded default, quietly ignoring whatever the file said — so pass a
 * function and it is resolved on the first request instead.
 */
type UploadOptions = multer.Options | (() => multer.Options)

/** Defers building the multer middleware until the first request reaches it. */
function lazyUpload(
  options: UploadOptions | undefined,
  apply: (instance: multer.Multer) => RequestHandler
): RequestHandler {
  let handler: RequestHandler | null = null

  return function uploadMiddleware(req, res, next) {
    handler ??= apply(multer(typeof options === 'function' ? options() : options))
    return handler(req, res, next)
  }
}

/** Accept one file on the named multipart field. */
export function UploadSingle(field: string, options?: UploadOptions): MethodDecorator {
  return function uploadSingleDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(
      target,
      String(property),
      lazyUpload(options, instance => instance.single(field))
    )
    return descriptor
  }
}

/** Accept up to `count` files on the named multipart field. */
export function UploadArray(field: string, count: number, options?: UploadOptions): MethodDecorator {
  return function uploadArrayDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(
      target,
      String(property),
      lazyUpload(options, instance => instance.array(field, count))
    )
    return descriptor
  }
}

/** Accept files across several named multipart fields. */
export function MultiPartFormMixed(fields: multer.Field[], options?: UploadOptions): MethodDecorator {
  return function multiPartFormMixedDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(
      target,
      String(property),
      lazyUpload(options, instance => instance.fields(fields))
    )
    return descriptor
  }
}

/** Parse a multipart form that carries no files. */
export function MultiPartFormText(): MethodDecorator {
  return function multiPartFormTextDecorator(target: any, property: any, descriptor: any) {
    RouteManager.registerEndpointMiddleware(target, String(property), multer().none())
    return descriptor
  }
}
