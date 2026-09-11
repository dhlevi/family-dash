import { describe, expect, it } from 'vitest'
import { allDayFireAt, planEventReminders, planTaskReminders } from '../../../lib/services/notifications/collect'
import type { Audience, ReminderSettings } from '../../../lib/services/notifications/collect'
import type { CalendarEvent, TaskItem } from '../../../lib/types/domain'

const audience: Audience = {
  topicsByPerson: new Map([
    ['skye', 'topic-skye'],
    ['dylan', 'topic-dylan']
  ]),
  topicsBySource: new Map([['source-school', 'topic-skye']]),
  household: 'topic-house'
}

const settings: ReminderSettings = {
  taskLeadMinutes: 30,
  taskOverdue: true,
  taskOverdueMinutes: 120,
  eventLeadMinutes: 30,
  allDayHour: 8,
  allDayDaysBefore: 0
}

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    title: 'Laundry',
    notes: null,
    assignee: 'Skye',
    category: null,
    priority: 0,
    dueAt: '2026-09-15T17:00:00.000Z',
    completedAt: null,
    recurrence: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    sourceId: 'source-school',
    externalUid: null,
    title: 'Swimming',
    description: null,
    location: null,
    startsAt: '2026-09-15T17:00:00.000Z',
    endsAt: '2026-09-15T18:00:00.000Z',
    allDay: false,
    rrule: null,
    recurrence: null,
    recurrenceUntil: null,
    seriesId: null,
    seriesStartsAt: null,
    colour: null,
    ...overrides
  }
}

describe('planTaskReminders', () => {
  it('sends a task to whoever it is assigned to', () => {
    const [due] = planTaskReminders([task()], audience, settings)

    expect(due?.topic).toBe('topic-skye')
    expect(due?.body).toContain('Skye')
    expect(due?.body).toContain('Laundry')
  })

  it('sends an unassigned task to everyone', () => {
    const [due] = planTaskReminders([task({ assignee: null })], audience, settings)

    expect(due?.topic).toBe('topic-house')
  })

  it('matches an assignee however it was typed', () => {
    // Assignee is free text somebody tapped out on a touchscreen.
    const [due] = planTaskReminders([task({ assignee: '  SKYE ' })], audience, settings)

    expect(due?.topic).toBe('topic-skye')
  })

  it('falls back to everyone for a name nobody has a topic for', () => {
    const [due] = planTaskReminders([task({ assignee: 'Granny' })], audience, settings)

    expect(due?.topic).toBe('topic-house')
  })

  it('warns ahead of the due time', () => {
    const [due] = planTaskReminders([task()], audience, settings)

    expect(due?.fireAt.toISOString()).toBe('2026-09-15T16:30:00.000Z')
  })

  it('follows up once after it has gone past', () => {
    const [, overdue] = planTaskReminders([task()], audience, settings)

    expect(overdue?.kind).toBe('task-overdue')
    expect(overdue?.fireAt.toISOString()).toBe('2026-09-15T19:00:00.000Z')
  })

  it('leaves the follow-up out when it is switched off', () => {
    const planned = planTaskReminders([task()], audience, { ...settings, taskOverdue: false })

    expect(planned).toHaveLength(1)
  })

  it('ignores a task with no due date, and one already done', () => {
    const planned = planTaskReminders(
      [task({ id: 'a', dueAt: null }), task({ id: 'b', completedAt: '2026-09-14T00:00:00.000Z' })],
      audience,
      settings
    )

    expect(planned).toEqual([])
  })

  it('puts the due time in the key, so rescheduling re-arms the reminder', () => {
    // And so a repeating chore gets a reminder for every turn it comes round.
    const [first] = planTaskReminders([task()], audience, settings)
    const [moved] = planTaskReminders([task({ dueAt: '2026-09-22T17:00:00.000Z' })], audience, settings)

    expect(first?.key).not.toBe(moved?.key)
  })
})

describe('planEventReminders', () => {
  it('warns ahead of the start', () => {
    const [soon] = planEventReminders([event()], audience, settings)

    expect(soon?.fireAt.toISOString()).toBe('2026-09-15T16:30:00.000Z')
  })

  it('sends it to whoever owns the calendar', () => {
    const [soon] = planEventReminders([event()], audience, settings)

    expect(soon?.topic).toBe('topic-skye')
  })

  it('sends an unclaimed calendar to everyone', () => {
    const [soon] = planEventReminders([event({ sourceId: 'source-bins' })], audience, settings)

    expect(soon?.topic).toBe('topic-house')
  })

  it('keys a repeating event on the occurrence, not the series', () => {
    // One row, many occurrences: keying on the series would announce it once
    // and then stay silent every week afterwards.
    const first = planEventReminders([event({ id: 'series-1', seriesId: 'series-1' })], audience, settings)
    const later = planEventReminders(
      [event({ id: 'series-1::2026-09-22T17:00:00.000Z', seriesId: 'series-1', startsAt: '2026-09-22T17:00:00.000Z' })],
      audience,
      settings
    )

    expect(first[0]?.key).not.toBe(later[0]?.key)
    expect(first[0]?.key).toContain('series-1')
  })

  it('announces an all-day event at a time of day instead', () => {
    const [soon] = planEventReminders(
      [event({ allDay: true, startsAt: '2026-09-15T00:00:00.000Z' })],
      audience,
      settings
    )

    expect(soon?.fireAt.getHours()).toBe(8)
    expect(soon?.fireAt.getDate()).toBe(15)
  })

  it('can announce an all-day event the evening before', () => {
    // Which is the only version of "bins tomorrow" that is any use.
    const [soon] = planEventReminders([event({ allDay: true, startsAt: '2026-09-15T00:00:00.000Z' })], audience, {
      ...settings,
      allDayHour: 18,
      allDayDaysBefore: 1
    })

    expect(soon?.fireAt.getDate()).toBe(14)
    expect(soon?.fireAt.getHours()).toBe(18)
    expect(soon?.body).toContain('Tomorrow')
  })

  it('mentions where, when the event says', () => {
    const [soon] = planEventReminders([event({ location: 'Panorama pool' })], audience, settings)

    expect(soon?.body).toContain('Panorama pool')
  })
})

describe('allDayFireAt', () => {
  it('reads the stored UTC midnight as a calendar date', () => {
    // Read as a local instant instead, a UTC-midnight event is the previous
    // evening anywhere west of Greenwich, and bin day lands a day early.
    const fireAt = allDayFireAt(new Date('2026-09-15T00:00:00.000Z'), 8, 0)

    expect(fireAt.getFullYear()).toBe(2026)
    expect(fireAt.getMonth()).toBe(8)
    expect(fireAt.getDate()).toBe(15)
    expect(fireAt.getHours()).toBe(8)
  })

  it('crosses a month boundary going backwards', () => {
    const fireAt = allDayFireAt(new Date('2026-10-01T00:00:00.000Z'), 18, 1)

    expect(fireAt.getMonth()).toBe(8)
    expect(fireAt.getDate()).toBe(30)
  })
})
