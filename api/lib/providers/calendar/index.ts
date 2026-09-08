import { CalendarProviderRegistry } from './CalendarProvider'
import { GoogleOAuth } from './GoogleOAuth'
import { GoogleProvider } from './GoogleProvider'
import { IcsProvider } from './IcsProvider'
import { LocalProvider } from './LocalProvider'

/**
 * Registers the calendar providers. Called once at startup.
 *
 * Google is registered whether or not an OAuth client is configured, so the
 * Settings page can explain what is missing rather than the type simply not
 * existing. Whether it is usable is `GoogleOAuth.isConfigured()`.
 */
export function registerCalendarProviders(): void {
  CalendarProviderRegistry.register(new LocalProvider(), new IcsProvider(), new GoogleProvider())

  console.info(`Calendar providers registered: ${CalendarProviderRegistry.types().join(', ')}`)
  console.info(
    GoogleOAuth.isConfigured()
      ? 'Google Calendar: OAuth client configured'
      : 'Google Calendar: no OAuth client configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to use it)'
  )
}

export { CalendarProviderRegistry } from './CalendarProvider'
export type { CalendarProvider } from './CalendarProvider'
export { GoogleOAuth } from './GoogleOAuth'
export { GoogleProvider } from './GoogleProvider'
export { IcsProvider } from './IcsProvider'
export { LocalProvider } from './LocalProvider'
