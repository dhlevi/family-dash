import type { Priority } from '../../services/notifications/plan'

/**
 * Somewhere to send a push notification.
 *
 * A seam for the same reason the calendar and weather providers are one: the
 * household should not have to care which service is behind it, and swapping
 * ntfy for something else should not reach into the sweep that decides *what*
 * to send.
 */
export interface NotifyMessage {
  topic: string
  title: string
  body: string
  priority: Priority
  /** ntfy tag names; most render as an emoji beside the title. */
  tags: string[]
  /** Absolute URL opened when the notification is tapped. */
  click?: string
}

export interface NotifyProvider {
  readonly id: string
  /** Whether this is configured enough to be worth calling. */
  isConfigured(): boolean
  /** Throws on failure, so the caller can record it against the task. */
  send(message: NotifyMessage): Promise<void>
}
