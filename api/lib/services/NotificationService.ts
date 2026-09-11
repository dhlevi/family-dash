import * as crypto from 'crypto'
import { TaskManager } from '../core/TaskManager'
import { healthValidators } from '../health-checks/HealthCheckLoader'
import { notifyProvider } from '../providers/notify'
import { CalendarSourceRepository } from '../repositories/CalendarSourceRepository'
import { EventRepository } from '../repositories/EventRepository'
import { NotificationRepository } from '../repositories/NotificationRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { TaskItemRepository } from '../repositories/TaskItemRepository'
import { normaliseName } from './people'
import { planEventReminders, planTaskReminders, type Audience, type ReminderSettings } from './notifications/collect'
import { decide, planStateChange, type PlannedNotification, type QuietHours } from './notifications/plan'

const settings = new SettingRepository()
const tasks = new TaskItemRepository()
const events = new EventRepository()
const sources = new CalendarSourceRepository()
const ledger = new NotificationRepository()

interface PersonProfile {
  colour?: string
  calendarSourceIds?: string[]
  ntfyTopic?: string
}

export interface SweepOutcome {
  sent: number
  /** Reminders whose moment had long passed; recorded, not delivered. */
  expired: number
  /** Not yet due; a later sweep will pick them up. */
  held: number
  failed: number
  reason: string | null
}

/**
 * Working out what the household should be told, and telling them.
 *
 * The dashboard has always known when a chore is overdue and when the bins go
 * out; it just had no way of saying so to anyone not standing in front of it.
 * This closes that loop.
 *
 * Everything it sends is already in the database,
 * so a sweep is cheap and cannot be held up by somebody else's server. What it
 * does that is not obvious is *not* send: a reminder goes out once, never
 * during quiet hours, and never at all if its moment passed while the Pi was
 * switched off.
 */
export class NotificationService {
  /** How far ahead to look for events. Covers the largest sensible lead. */
  private static readonly EVENT_HORIZON_DAYS = 8

  /** How long the ledger remembers. Long enough that nothing can fire twice. */
  private static readonly LEDGER_DAYS = 30

  public async configuration(): Promise<{
    enabled: boolean
    quiet: QuietHours
    staleAfterMinutes: number
    systemFaults: boolean
    calendarSourceIds: string[]
    reminders: ReminderSettings
  }> {
    const stored = await settings.all()
    const number = (key: string, fallback: number): number =>
      typeof stored[key] === 'number' ? (stored[key] as number) : fallback
    const boolean = (key: string, fallback: boolean): boolean =>
      typeof stored[key] === 'boolean' ? (stored[key] as boolean) : fallback

    return {
      enabled: boolean('notify.enabled', false),
      quiet: { from: number('notify.quietFrom', 21), to: number('notify.quietTo', 7) },
      staleAfterMinutes: number('notify.staleAfterMinutes', 30),
      systemFaults: boolean('notify.systemFaults', true),
      calendarSourceIds: Array.isArray(stored['notify.calendarSourceIds'])
        ? (stored['notify.calendarSourceIds'] as string[])
        : [],
      reminders: {
        taskLeadMinutes: number('notify.taskLeadMinutes', 30),
        taskOverdue: boolean('notify.taskOverdue', true),
        taskOverdueMinutes: number('notify.taskOverdueMinutes', 120),
        eventLeadMinutes: number('notify.eventLeadMinutes', 30),
        allDayHour: number('notify.allDayHour', 8),
        allDayDaysBefore: number('notify.allDayDaysBefore', 0)
      }
    }
  }

  /** Who gets what, built from the household roster and the calendars. */
  public async audience(): Promise<Audience> {
    const stored = await settings.all()
    const profiles = (stored['people.profiles'] ?? {}) as Record<string, PersonProfile>
    const household = typeof stored['notify.householdTopic'] === 'string' ? stored['notify.householdTopic'] : ''

    const topicsByPerson = new Map<string, string>()
    const topicsBySource = new Map<string, string>()

    for (const [name, profile] of Object.entries(profiles)) {
      if (!profile?.ntfyTopic) continue

      topicsByPerson.set(normaliseName(name), profile.ntfyTopic)

      // A calendar linked to exactly one person addresses that person. Linked
      // to two, it belongs to neither in particular and goes to everyone.
      for (const sourceId of profile.calendarSourceIds ?? []) {
        topicsBySource.set(sourceId, topicsBySource.has(sourceId) ? household : profile.ntfyTopic)
      }
    }

    return { topicsByPerson, topicsBySource, household }
  }

  /**
   * Generates any topic that does not exist yet.
   *
   * Generated, never chosen: on ntfy the topic is the only thing between a
   * message and anyone who can reach the server, so "family-tasks" would be a
   * password of "password". Idempotent, so the Settings page can call it
   * whenever somebody is added to the household.
   */
  public async ensureTopics(): Promise<{ household: string; people: Record<string, string> }> {
    const stored = await settings.all()
    const names = Array.isArray(stored['tasks.assignees']) ? (stored['tasks.assignees'] as string[]) : []
    const profiles = { ...((stored['people.profiles'] ?? {}) as Record<string, PersonProfile>) }

    const household =
      typeof stored['notify.householdTopic'] === 'string' && stored['notify.householdTopic'].length > 0
        ? stored['notify.householdTopic']
        : NotificationService.newTopic()

    const people: Record<string, string> = {}
    for (const name of names) {
      const existing = profiles[name]?.ntfyTopic
      const topic = existing && existing.length > 0 ? existing : NotificationService.newTopic()

      profiles[name] = { ...profiles[name], ntfyTopic: topic }
      people[name] = topic
    }

    await settings.setMany({ 'notify.householdTopic': household, 'people.profiles': profiles })

    return { household, people }
  }

  private static newTopic(): string {
    // 24 hex characters. ntfy allows 64, and this is already far beyond
    // guessing while staying short enough to read off a screen if needed.
    return `fd-${crypto.randomBytes(12).toString('hex')}`
  }

  /** Where a tapped notification should land. Empty disables the link. */
  private static async dashboardUrl(): Promise<string> {
    const stored = await settings.all()
    const lan = typeof stored['network.lanAddress'] === 'string' ? stored['network.lanAddress'] : ''

    return lan.replace(/\/+$/, '')
  }

  /**
   * One pass: work out everything that should have gone by now, and send
   * whatever has not already been dealt with.
   */
  public async sweep(now = new Date()): Promise<SweepOutcome> {
    const outcome: SweepOutcome = { sent: 0, expired: 0, held: 0, failed: 0, reason: null }
    const configuration = await this.configuration()

    if (!configuration.enabled) {
      outcome.reason = 'Notifications are switched off'
      return outcome
    }

    const provider = notifyProvider()
    if (!provider.isConfigured()) {
      outcome.reason = 'No notification server is configured'
      return outcome
    }

    const who = await this.audience()
    if (who.household.length === 0) {
      outcome.reason = 'No topics have been generated yet'
      return outcome
    }

    const planned = [
      ...(await this.taskPlans(who, configuration.reminders)),
      ...(await this.eventPlans(who, configuration.reminders, configuration.calendarSourceIds, now)),
      ...(configuration.systemFaults ? await this.systemPlans(who.household, now) : [])
    ]

    // One round trip for the whole sweep rather than one per reminder.
    const already = await ledger.handled(planned.map(entry => entry.key))
    const base = await NotificationService.dashboardUrl()

    for (const entry of planned) {
      if (already.has(entry.key)) continue

      const verdict = decide(entry, now, configuration.quiet, configuration.staleAfterMinutes)

      if (verdict.action === 'hold') {
        outcome.held++
        continue
      }

      if (verdict.action === 'expire') {
        await ledger.claim(entry, verdict.fireAt, { sent: false, suppressed: 'stale' })
        outcome.expired++
        continue
      }

      // Claim before sending: two sweeps overlapping must not send twice, and
      // the unique key is what settles the race. A failed send gives the claim
      // back so the next sweep retries.
      const won = await ledger.claim(entry, verdict.fireAt, { sent: true })
      if (!won) continue

      try {
        await provider.send({
          topic: entry.topic,
          title: entry.title,
          body: entry.body,
          priority: entry.priority,
          tags: entry.tags,
          ...(base && entry.clickPath ? { click: `${base}${entry.clickPath}` } : {})
        })
        outcome.sent++
      } catch (error) {
        await ledger.release(entry.key)
        outcome.failed++
        outcome.reason = (error as Error).message
      }
    }

    await ledger.prune(NotificationService.LEDGER_DAYS)

    return outcome
  }

  private async taskPlans(who: Audience, reminders: ReminderSettings): Promise<PlannedNotification[]> {
    return planTaskReminders(await tasks.list({ includeCompleted: false }), who, reminders)
  }

  /**
   * Events worth announcing.
   *
   * Empty selection means the local family calendar only, which is the right
   * default: an event from a subscribed Google or iCloud calendar is already
   * being announced by the phone it came from, and saying it twice is how
   * people end up turning notifications off.
   */
  private async eventPlans(
    who: Audience,
    reminders: ReminderSettings,
    chosen: string[],
    now: Date
  ): Promise<PlannedNotification[]> {
    const all = await sources.all()
    const wanted = chosen.length > 0 ? chosen : all.filter(source => source.type === 'local').map(source => source.id)
    if (wanted.length === 0) return []

    // Back a little as well as forward: an all-day reminder set for the
    // evening before is scheduled earlier than the event it is about.
    const from = new Date(now.getTime() - 2 * 86_400_000)
    const to = new Date(now.getTime() + NotificationService.EVENT_HORIZON_DAYS * 86_400_000)

    return planEventReminders(await events.inRange({ from, to }, wanted), who, reminders)
  }

  /**
   * Faults the dashboard cannot fix itself.
   *
   * This is the half of notifications that protects the install rather than
   * the household: a Google token that expired, a media volume that did not
   * come back, a sync that has been failing for a week. All of it already
   * shows in `/healthCheck` and in Settings, where nobody looks.
   *
   * Each probe's state is written to the ledger, so an unchanged fault stays
   * quiet, a *different* one is announced, and a recovery is worth one
   * message. The first sweep on a healthy system records a baseline silently
   * rather than announcing that nothing is wrong.
   *
   * `now` comes from the sweep rather than being taken here. A fault has no
   * natural moment of its own; it is due the instant it is noticed, and a
   * freshly taken timestamp is a few milliseconds *after* the one the sweep
   * compares against, which held every fault back on every run permanently.
   */
  private async systemPlans(household: string, now: Date): Promise<PlannedNotification[]> {
    const states: Array<{ name: string; healthy: boolean; message: string }> = []

    for (const validator of healthValidators) {
      try {
        const result = await validator.validate()
        states.push({ name: validator.name, healthy: result.healthy, message: result.message ?? '' })
      } catch (error) {
        states.push({ name: validator.name, healthy: false, message: (error as Error).message })
      }
    }

    for (const task of TaskManager.status()) {
      if (!task.enabled) continue
      states.push({ name: `job:${task.name}`, healthy: task.lastError === null, message: task.lastError ?? '' })
    }

    const planned: PlannedNotification[] = []
    const digest = (value: string): string => crypto.createHash('sha1').update(value).digest('hex').slice(0, 12)

    for (const state of states) {
      const previous = await ledger.latestFor(`system:${state.name}:`)
      const change = planStateChange(state, previous?.detail ?? null, now, digest)

      if (!change) continue

      const message: PlannedNotification = {
        kind: change.healthy ? 'system-recovered' : 'system-fault',
        key: change.key,
        topic: household,
        title: change.healthy ? `${state.name} is working again` : `${state.name} needs attention`,
        body: change.healthy ? 'Recovered on its own.' : state.message || 'The check is failing.',
        fireAt: now,
        priority: change.healthy ? 'low' : 'high',
        tags: [change.healthy ? 'white_check_mark' : 'rotating_light'],
        clickPath: '/settings',
        detail: change.detail
      }

      // Nothing recorded yet and nothing wrong: remember it, say nothing.
      if (!change.announce) {
        await ledger.claim(message, now, { sent: false, suppressed: 'baseline' })
        continue
      }

      planned.push(message)
    }

    return planned
  }

  /** Sends one message now, so somebody can check a phone is subscribed. */
  public async test(topic: string): Promise<void> {
    const base = await NotificationService.dashboardUrl()

    await notifyProvider().send({
      topic,
      title: 'Family dashboard',
      body: 'Notifications are working.',
      priority: 'default',
      tags: ['wave'],
      ...(base ? { click: base } : {})
    })
  }
}
