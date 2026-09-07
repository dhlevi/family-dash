import { NextFunction, Request, Response } from 'express'

/**
 * Tell every layer between here and the screen not to keep a copy.
 *
 * The dashboard polls its widgets, and a wall-mounted display that caches a
 * task list is worse than one that shows a spinner — so the endpoints the
 * dashboard reads are marked `@NoCache()`.
 */
export function noCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
  next()
}
