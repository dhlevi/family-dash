import { RegisteredRoute, RouteManager } from './RouteManager'

/**
 * Builds an OpenAPI 3.0 document from the RouteManager's registry.
 *
 * The original template generated this with `tsoa spec` as a build step,
 * which meant the committed swagger.json could drift from the code and that
 * tsoa's compiler-API pass had to keep working across TypeScript upgrades.
 * Generating it from the same metadata the router was built from means the
 * document describes the routes that actually exist, and there is no build
 * step to break.
 *
 * The trade-off: request and response *shapes* are not described, because
 * `emitDecoratorMetadata` only preserves primitive constructors. Endpoints
 * document their parameters, status codes and bodies-as-objects. The Vue
 * client is typed from `web/src/api/types.ts` instead.
 */
export class OpenApiGenerator {
  private constructor() {
    /* static only */
  }

  public static generate(options: { title: string; version: string; description?: string }): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {}

    for (const route of RouteManager.registeredRoutes()) {
      if (route.hidden) continue

      const path = OpenApiGenerator.toOpenApiPath(route.path)
      paths[path] ??= {}
      paths[path][route.method] = OpenApiGenerator.toOperation(route)
    }

    return {
      openapi: '3.0.3',
      info: {
        title: options.title,
        version: options.version,
        description: options.description
      },
      servers: [{ url: '/', description: 'This service' }],
      tags: OpenApiGenerator.tags(),
      paths,
      components: {
        schemas: {
          Error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
              details: { type: 'object', nullable: true }
            },
            required: ['message', 'code']
          }
        }
      }
    }
  }

  private static tags(): Array<{ name: string }> {
    const names = new Set(
      RouteManager.registeredRoutes()
        .filter(route => !route.hidden)
        .map(route => route.controller)
    )
    return [...names].sort().map(name => ({ name }))
  }

  /** Express ':id' -> OpenAPI '{id}' */
  private static toOpenApiPath(path: string): string {
    return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  }

  private static toOperation(route: RegisteredRoute): Record<string, unknown> {
    const parameters = route.params
      .filter(param => ['path', 'query', 'header'].includes(param.source))
      .map(param => ({
        name: param.name,
        in: param.source,
        required: param.source === 'path' ? true : param.required,
        schema: { type: 'string' }
      }))

    const hasBody = route.params.some(param => param.source === 'body')
    const hasUpload = route.params.some(param => param.source === 'file' || param.source === 'files')

    const responses: Record<string, unknown> = {
      [String(route.successCode)]: { description: 'Success' }
    }
    for (const response of route.responses) {
      responses[String(response.code)] = {
        description: response.description ?? 'Error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
    responses['500'] ??= {
      description: 'Internal Server Error',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
    }

    const operation: Record<string, unknown> = {
      operationId: `${route.controller}_${route.handler}`,
      tags: [route.controller],
      summary: OpenApiGenerator.humanize(route.handler),
      parameters,
      responses
    }

    if (hasUpload) {
      operation.requestBody = {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object' } } }
      }
    } else if (hasBody) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } }
      }
    }

    return operation
  }

  /** 'listUpcomingEvents' -> 'List upcoming events' */
  private static humanize(handler: string): string {
    const spaced = handler.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
  }
}
