import { CalendarProviderRegistry } from './CalendarProvider'
import { IcsProvider } from './IcsProvider'
import { LocalProvider } from './LocalProvider'

/**
 * Registers the calendar providers. Called once at startup.
 *
 * The Google provider joins this list in the next pass; nothing else has to
 * change when it does.
 */
export function registerCalendarProviders(): void {
  CalendarProviderRegistry.register(new LocalProvider(), new IcsProvider())
  console.info(`Calendar providers registered: ${CalendarProviderRegistry.types().join(', ')}`)
}

export { CalendarProviderRegistry } from './CalendarProvider'
export type { CalendarProvider } from './CalendarProvider'
export { IcsProvider } from './IcsProvider'
export { LocalProvider } from './LocalProvider'
