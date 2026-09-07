/**
 * family-dash API entry point.
 *
 * `reflect-metadata` must be imported before any decorated class is loaded,
 * so it comes first and stands alone.
 */
import 'reflect-metadata'
import { Application } from './Application'

Application.createApplication().catch(error => {
  console.error('Failed to start the family-dash API', error)
  process.exit(1)
})
