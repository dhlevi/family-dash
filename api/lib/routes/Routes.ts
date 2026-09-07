import express, { Router } from 'express'
import * as swaggerUi from 'swagger-ui-express'
import { OpenApiGenerator } from '../core/OpenApiGenerator'
import { RouteManager } from '../core/RouteManager'
import { HealthValidators } from '../middleware/HealthServiceMiddleware'
import { healthValidators } from '../health-checks/HealthCheckLoader'

// --- controllers ------------------------------------------------------------
// Every controller must be instantiated here. The Controller base constructor
// registers the instance with the RouteManager; a decorated controller that is
// never constructed has no instance to call, and startup fails with a message
// saying so rather than quietly serving nothing.
import { SystemController } from '../controllers/SystemController'

/**
 * Builds the application router: the default endpoints, then everything the
 * decorated controllers declare.
 */
export default function buildRouter(): Router {
  const router = express.Router()

  console.info('\n### Registering routes ###')

  // Health check. Runs the probes in health-checks/HealthCheckLoader.ts and
  // answers 503 if a critical one fails, which is what the container
  // healthcheck and `docker compose ps` watch.
  router.get('/healthCheck', HealthValidators(...healthValidators))

  // Controllers. Order is irrelevant; the RouteManager sorts out the wiring.
  new SystemController()

  RouteManager.initializeRoutes(router)

  // Swagger UI, mounted after initializeRoutes so the document describes the
  // routes that were actually registered.
  const spec = OpenApiGenerator.generate({
    title: 'family-dash API',
    version: process.env.npm_package_version ?? '0.1.0',
    description:
      'Self-hosted family dashboard: calendar, tasks, notes, recipes and meal planning, ' +
      'photos, weather, news and freehand drawing.'
  })

  router.get('/openapi.json', (_req, res) => res.json(spec))
  router.use('/openapi', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'family-dash API' }))

  return router
}
