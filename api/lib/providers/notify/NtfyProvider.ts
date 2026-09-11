import { AppProperties } from '../../core/AppProperties'
import { OUTBOUND_USER_AGENT } from '../userAgent'
import type { NotifyMessage, NotifyProvider } from './NotifyProvider'

/**
 * Push notifications through ntfy.
 *
 * Chosen because it needs no account and no API key: the one thing a wall
 * display must never depend on is a credential that expires while nobody is
 * watching, which is the same reasoning that put ICS subscriptions ahead of
 * Google OAuth for calendars.
 *
 * The default points at the ntfy container in this compose stack, so messages
 * stay on the household's own hardware. A topic is the only thing standing
 * between a message and anyone who can reach the server, which is why they are
 * generated rather than chosen - see NotificationSettings.
 */
export class NtfyProvider implements NotifyProvider {
  public readonly id = 'ntfy'

  private static timeoutMs(): number {
    return AppProperties.getNumber('notify.ntfy.timeoutMs', 10000)
  }

  /**
   * Where the server is, as the *API* reaches it.
   *
   * Inside compose that is the service name, which is not a URL any phone can
   * use. `notify.ntfy.publicUrl` is what the Settings page shows people to
   * subscribe to. Keeping them apart means the container talks over the docker
   * network while the QR codes point at something a phone can actually open.
   */
  public static baseUrl(): string {
    return AppProperties.getString('notify.ntfy.url', 'http://ntfy:80').replace(/\/+$/, '')
  }

  /** An access token, for a server that has been locked down. Usually empty. */
  private static token(): string {
    return AppProperties.getString('notify.ntfy.token', '')
  }

  public isConfigured(): boolean {
    return NtfyProvider.baseUrl().length > 0
  }

  public async send(message: NotifyMessage): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NtfyProvider.timeoutMs())

    const token = NtfyProvider.token()

    try {
      const response = await fetch(`${NtfyProvider.baseUrl()}/`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': OUTBOUND_USER_AGENT,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        // The JSON form rather than headers: a task title can contain any
        // character a person can type, and header values cannot.
        body: JSON.stringify({
          topic: message.topic,
          title: message.title,
          message: message.body,
          priority: NtfyProvider.priorityNumber(message.priority),
          tags: message.tags,
          ...(message.click ? { click: message.click } : {})
        })
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`ntfy answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** ntfy takes 1-5; the names are only for this application's own settings. */
  private static priorityNumber(priority: NotifyMessage['priority']): number {
    switch (priority) {
      case 'min':
        return 1
      case 'low':
        return 2
      case 'high':
        return 4
      case 'urgent':
        return 5
      default:
        return 3
    }
  }
}
