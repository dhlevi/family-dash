import { z } from 'zod'
import { AppProperties } from '../core/AppProperties'
import { ApiError } from '../core/model/ApiError'
import { NotificationRepository } from '../repositories/NotificationRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { NotificationService, type SweepOutcome } from './NotificationService'
import type { SentNotification } from '../repositories/NotificationRepository'

const service = new NotificationService()
const ledger = new NotificationRepository()
const settings = new SettingRepository()

const testSchema = z.object({ topic: z.string().trim().min(1).max(64) })

export interface NotificationStatus {
  enabled: boolean
  /** Where phones subscribe. Empty until it has been set. */
  serverUrl: string
  householdTopic: string
  /** Person name to topic, for the subscribe codes. */
  people: Record<string, string>
  recent: SentNotification[]
}

/**
 * The notification settings as the UI sees them.
 *
 * Topics are returned in full rather than masked: this is a LAN appliance
 * with no accounts, the Settings page has to show a QR code somebody can
 * point a phone at, and a topic nobody can read is a topic nobody can
 * subscribe to. The same reasoning already applies to the ICS feed addresses
 * on the same page.
 */
export class NotificationEndpoints {
  public async status(): Promise<NotificationStatus> {
    const stored = await settings.all()
    const profiles = (stored['people.profiles'] ?? {}) as Record<string, { ntfyTopic?: string }>

    const people: Record<string, string> = {}
    for (const [name, profile] of Object.entries(profiles)) {
      if (profile?.ntfyTopic) people[name] = profile.ntfyTopic
    }

    return {
      enabled: stored['notify.enabled'] === true,
      // Stored value over the configured one. `settings.all()` returns only
      // what has actually been written, so the catalogue's default, which
      // reads NTFY_PUBLIC_URL has to be applied here rather than assumed.
      serverUrl:
        typeof stored['notify.serverUrl'] === 'string' && stored['notify.serverUrl'].length > 0
          ? stored['notify.serverUrl']
          : AppProperties.getString('notify.ntfy.publicUrl', ''),
      householdTopic: typeof stored['notify.householdTopic'] === 'string' ? stored['notify.householdTopic'] : '',
      people,
      recent: await ledger.recent(15)
    }
  }

  /** Generates any topic that does not exist yet. Safe to call repeatedly. */
  public async setup(): Promise<NotificationStatus> {
    await service.ensureTopics()
    return this.status()
  }

  public async test(body: unknown): Promise<void> {
    const { topic } = testSchema.parse(body)

    try {
      await service.test(topic)
    } catch (error) {
      throw ApiError.badGateway(`The notification server would not accept the message: ${(error as Error).message}`)
    }
  }

  /** Runs a sweep now rather than waiting for the schedule. */
  public async sweep(): Promise<SweepOutcome> {
    return service.sweep()
  }
}
