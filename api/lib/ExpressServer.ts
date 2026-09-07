import compression from 'compression'
import cors from 'cors'
import express, { Express } from 'express'
import helmet from 'helmet'
import { Server } from 'http'
import * as path from 'path'
import { AppProperties } from './core/AppProperties'
import { errorHandler, notFoundHandler } from './middleware/ErrorMiddleware'
import buildRouter from './routes/Routes'

/**
 * Wrapper around the Express app and Node's HTTP server: middleware, static
 * content, the router and a clean shutdown path.
 */
export class ExpressServer {
  private server: Express | null = null
  private httpServer: Server | null = null

  public async setup(port: number): Promise<Express> {
    const server = express()

    // Behind the nginx container, so client IPs and protocol come from
    // forwarded headers rather than the socket.
    server.set('trust proxy', true)
    server.disable('x-powered-by')

    this.setupSecurityMiddleware(server)
    this.setupStandardMiddleware(server)
    this.setupStaticContent(server)

    server.use(buildRouter())

    // Order matters: 404 for anything unmatched, then the error handler last.
    server.use(notFoundHandler)
    server.use(errorHandler)

    this.httpServer = this.listen(server, port)
    this.server = server

    return server
  }

  private setupSecurityMiddleware(server: Express): void {
    server.use(
      helmet({
        // The API serves JSON, the swagger UI (which needs inline styles) and
        // photo files. The Vue app is served by nginx, which sets its own
        // policy, so there is nothing here for a CSP to protect.
        contentSecurityPolicy: false,
        // Photos and thumbnails are loaded by the UI from a different origin
        // in dev; the default same-origin policy would block them.
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginEmbedderPolicy: false
      })
    )

    const origins = AppProperties.getList('server.cors.origins', ['*'])
    server.use(
      cors({
        origin: origins.includes('*') ? true : origins,
        credentials: false
      })
    )
  }

  private setupStandardMiddleware(server: Express): void {
    const bodyLimit = AppProperties.getString('server.body.limit', '10mb')

    server.use(compression())
    // Drawings post a full stroke list, which can be large for a detailed
    // sketch, so the limit is deliberately generous.
    server.use(express.json({ limit: bodyLimit }))
    server.use(express.urlencoded({ extended: true, limit: bodyLimit }))

    server.use((req, _res, next) => {
      if (AppProperties.getString('logging.level', 'info') === 'debug') {
        console.debug(`${req.method} ${req.originalUrl}`)
      }
      next()
    })
  }

  /**
   * Serve the media volume directly. Photo files and drawing thumbnails are
   * static bytes; making Node stream them through a handler would be pure
   * overhead on a Pi.
   */
  private setupStaticContent(server: Express): void {
    const mediaRoot = path.resolve(AppProperties.getString('media.root', '/media'))

    server.use(
      '/media',
      express.static(mediaRoot, {
        index: false,
        // Immutable in practice: the scanner writes a new path rather than
        // overwriting, so the browser can hold on to these.
        maxAge: '7d',
        fallthrough: true,
        dotfiles: 'ignore'
      })
    )

    console.info(`Serving media from ${mediaRoot} at /media`)
  }

  private listen(server: Express, port: number): Server {
    return server.listen(port, () => {
      console.info(`\nfamily-dash API listening on port ${port}`)
      console.info(`  health  http://localhost:${port}/healthCheck`)
      console.info(`  docs    http://localhost:${port}/openapi\n`)
    })
  }

  public async kill(): Promise<void> {
    if (!this.httpServer) return

    await new Promise<void>(resolve => {
      this.httpServer?.close(error => {
        if (error) console.error('Error closing the HTTP server', error)
        resolve()
      })
    })

    this.httpServer = null
    this.server = null
    console.info('HTTP server closed')
  }

  public express(): Express | null {
    return this.server
  }
}
