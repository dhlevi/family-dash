import { normaliseName } from '../people'
import type { CalendarEvent, TaskItem } from '../../types/domain'
import type { PlannedNotification } from './plan'

/**
 * Turning the household's data into the reminders it implies.
 */

export interface Audience {
  /** Lower-cased person name to their topic. */
  topicsByPerson: ReadonlyMap<string, string>
  /** Calendar source id to the topic of whoever owns it. */
  topicsBySource: ReadonlyMap<string, string>
  /** Where anything unaddressed goes. */
  household: string
}

export interface ReminderSettings {
  taskLeadMinutes: number
  taskOverdue: boolean
  taskOverdueMinutes: number
  eventLeadMinutes: number
  allDayHour: number
  allDayDaysBefore: number
}

/** Who a task belongs to, falling back to everyone. */
function topicForTask(task: TaskItem, audience: Audience): string {
  if (task.assignee === null) return audience.household

  return audience.topicsByPerson.get(normaliseName(task.assignee)) ?? audience.household
}

export function planTaskReminders(
  tasks: readonly TaskItem[],
  audience: Audience,
  settings: ReminderSettings
): PlannedNotification[] {
  const planned: PlannedNotification[] = []

  for (const task of tasks) {
    if (task.dueAt === null || task.completedAt !== null) continue

    const dueAt = new Date(task.dueAt)
    const topic = topicForTask(task, audience)
    const who = task.assignee ? `${task.assignee} - ` : ''

    // The due time is part of the key, so moving a task re-arms its reminder
    // and a repeating chore gets one for every turn it comes round.
    planned.push({
      kind: 'task-due',
      key: `task-due:${task.id}:${task.dueAt}`,
      topic,
      title: 'Due soon',
      body: `${who}${task.title}`,
      fireAt: new Date(dueAt.getTime() - settings.taskLeadMinutes * 60_000),
      priority: 'default',
      tags: ['ballot_box_with_check'],
      clickPath: '/tasks'
    })

    if (settings.taskOverdue) {
      planned.push({
        kind: 'task-overdue',
        key: `task-overdue:${task.id}:${task.dueAt}`,
        topic,
        title: 'Still not done',
        body: `${who}${task.title}`,
        fireAt: new Date(dueAt.getTime() + settings.taskOverdueMinutes * 60_000),
        priority: 'high',
        tags: ['warning'],
        clickPath: '/tasks'
      })
    }
  }

  return planned
}

/**
 * When an all-day event should be announced.
 *
 * "Thirty minutes before" is meaningless for something that starts at
 * midnight, so these get a time of day instead, and a day count, because the
 * genuinely useful version of "bins tomorrow" is said the evening before.
 *
 * All-day events are stored at UTC midnight so that they mean the same
 * calendar date everywhere, which is why the date is read in UTC and the
 * reminder is then built in local time.
 */
export function allDayFireAt(startsAt: Date, hour: number, daysBefore: number): Date {
  return new Date(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate() - daysBefore, hour, 0, 0, 0)
}

export function planEventReminders(
  events: readonly CalendarEvent[],
  audience: Audience,
  settings: ReminderSettings
): PlannedNotification[] {
  return events.map(event => {
    const startsAt = new Date(event.startsAt)

    // A repeating event is one row with many occurrences, so the key has to
    // carry the occurrence or it would be announced once and never again.
    const key = `event-soon:${event.seriesId ?? event.id}:${event.startsAt}`

    return {
      kind: 'event-soon' as const,
      key,
      topic: audience.topicsBySource.get(event.sourceId) ?? audience.household,
      title: event.title,
      body: describeEvent(event, settings),
      fireAt: event.allDay
        ? allDayFireAt(startsAt, settings.allDayHour, settings.allDayDaysBefore)
        : new Date(startsAt.getTime() - settings.eventLeadMinutes * 60_000),
      priority: 'default' as const,
      tags: ['calendar'],
      clickPath: '/calendar'
    }
  })
}

function describeEvent(event: CalendarEvent, settings: ReminderSettings): string {
  const where = event.location ? ` · ${event.location}` : ''

  if (event.allDay) {
    return settings.allDayDaysBefore > 0 ? `Tomorrow${where}` : `Today${where}`
  }

  const time = new Date(event.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  return settings.eventLeadMinutes === 0 ? `Starting now${where}` : `At ${time}${where}`
}
