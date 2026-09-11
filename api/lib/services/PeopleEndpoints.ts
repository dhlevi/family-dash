import { EventRepository } from '../repositories/EventRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { TaskItemRepository } from '../repositories/TaskItemRepository'
import { assignColours, normaliseName } from './people'
import type { CalendarEvent, PersonDay, TaskItem } from '../types/domain'

const settings = new SettingRepository()
const tasks = new TaskItemRepository()
const events = new EventRepository()

interface PersonProfile {
  colour?: string
  calendarSourceIds?: string[]
}

/**
 * Everybody's day, side by side.
 */
export class PeopleEndpoints {
  /** At most this many tasks per column; the rest become a count. */
  private static readonly TASKS_SHOWN = 6

  /** And this many events, for the same reason. */
  private static readonly EVENTS_SHOWN = 4

  public async today(now = new Date()): Promise<PersonDay[]> {
    const stored = await settings.all()

    const names = Array.isArray(stored['tasks.assignees']) ? (stored['tasks.assignees'] as string[]) : []
    if (names.length === 0) return []

    const profiles = (stored['people.profiles'] ?? {}) as Record<string, PersonProfile>

    const overrides: Record<string, string> = {}
    for (const [name, profile] of Object.entries(profiles)) {
      if (profile?.colour) overrides[name] = profile.colour
    }

    const colours = assignColours(names, overrides)

    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    // Every calendar anybody is linked to, fetched once and split up below.
    // Asking per person would be one query each for a view that loads on
    // every wake of the display.
    const linkedSourceIds = [...new Set(Object.values(profiles).flatMap(profile => profile?.calendarSourceIds ?? []))]

    const [openTasks, doneCounts, todaysEvents] = await Promise.all([
      tasks.openForAssignees(names),
      tasks.completedCountsSince(names, dayStart),
      linkedSourceIds.length > 0
        ? events.inRange({ from: dayStart, to: dayEnd }, linkedSourceIds)
        : Promise.resolve([] as CalendarEvent[])
    ])

    return names.map(name => {
      const key = normaliseName(name)
      const mine = openTasks.filter(task => task.assignee !== null && normaliseName(task.assignee) === key)

      // Overdue and due-today on one side, everything still waiting on the
      // other. An undated task is not "today's work" but it is not nothing
      // either, so it is counted rather than listed.
      const due: TaskItem[] = []
      let later = 0

      for (const task of mine) {
        if (task.dueAt !== null && new Date(task.dueAt) < dayEnd) due.push(task)
        else later++
      }

      const sourceIds = new Set(profiles[name]?.calendarSourceIds ?? [])
      const mineToday = todaysEvents.filter(event => sourceIds.has(event.sourceId))

      return {
        name,
        colour: colours.get(name) ?? '#3f8fd6',
        tasks: due.slice(0, PeopleEndpoints.TASKS_SHOWN),
        events: mineToday.slice(0, PeopleEndpoints.EVENTS_SHOWN),
        laterCount: later + Math.max(due.length - PeopleEndpoints.TASKS_SHOWN, 0),
        doneToday: doneCounts.get(key) ?? 0
      }
    })
  }
}
