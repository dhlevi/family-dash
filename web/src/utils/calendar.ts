import { addDays, startOfDay, toDateInput } from './datetime'
import type { CalendarEvent, CalendarSource } from '@/api/types'

/**
 * Placing events onto the days of a grid.
 *
 * Two things make this fiddly, and both fail silently by drawing an event on
 * the wrong day:
 *
 * 1. All-day events carry an *exclusive* end, following iCalendar so a
 *    one-day event runs from midnight to the next midnight. Taken literally
 *    that stretches every all-day event across one day too many.
 *
 * 2. All-day events are stored at UTC midnight, which is what makes them
 *    timezone-independent on the wire. They must be read back as calendar
 *    *dates*, not as instants: `new Date('2026-09-20T00:00:00Z')` is the
 *    19th at 17:00 in Vancouver, so interpreting it locally puts a Pro-D day
 *    on the wrong date. Every read goes through `eventStart`/`eventEnd`.
 */

/**
 * An all-day instant (UTC midnight) as a local Date on the same calendar
 * date, so comparisons and formatting operate on the date that was meant.
 */
export function fromAllDayInstant(iso: string): Date {
  const instant = new Date(iso)

  return new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())
}

/**
 * A local calendar date as the UTC-midnight instant the API stores for an
 * all-day event. The inverse of `fromAllDayInstant`.
 */
export function toAllDayInstant(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString()
}

/** An event's start, as a local Date. */
export function eventStart(event: CalendarEvent): Date {
  return event.allDay ? fromAllDayInstant(event.startsAt) : new Date(event.startsAt)
}

/** An event's end, as a local Date. Still exclusive for all-day events. */
export function eventEnd(event: CalendarEvent): Date {
  return event.allDay ? fromAllDayInstant(event.endsAt) : new Date(event.endsAt)
}

/** The last day an event actually occupies. */
export function lastDayOf(event: CalendarEvent): Date {
  const start = eventStart(event)
  const end = eventEnd(event)

  if (event.allDay) {
    // Exclusive end: step back a day, but never before the start.
    const inclusive = addDays(end, -1)
    return inclusive < start ? startOfDay(start) : startOfDay(inclusive)
  }

  // A timed event ending exactly at midnight belongs to the previous day,
  // not to the new one it merely touches.
  if (end.getHours() === 0 && end.getMinutes() === 0 && end > start) {
    return startOfDay(addDays(end, -1))
  }

  return startOfDay(end)
}

export function coversDay(event: CalendarEvent, day: Date): boolean {
  const dayStart = startOfDay(day)

  return startOfDay(eventStart(event)) <= dayStart && lastDayOf(event) >= dayStart
}

/**
 * Groups events by day key ('YYYY-MM-DD'), repeating a multi-day event on
 * each day it covers so it shows up across the grid.
 */
export function eventsByDay(events: CalendarEvent[], days: Date[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>()
  for (const day of days) byDay.set(toDateInput(day), [])

  for (const event of events) {
    for (const day of days) {
      if (!coversDay(event, day)) continue
      byDay.get(toDateInput(day))?.push(event)
    }
  }

  // All-day first, then by start time: matches how people scan a day cell.
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return eventStart(a).getTime() - eventStart(b).getTime()
    })
  }

  return byDay
}

/** Events on a given day, sorted the same way. */
export function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return eventsByDay(events, [day]).get(toDateInput(day)) ?? []
}

/**
 * Groups events into the days that actually have something on them, for the
 * agenda view. Empty days are omitted rather than padding the list.
 */
export function agendaDays(
  events: CalendarEvent[],
  from: Date,
  to: Date
): Array<{ day: Date; events: CalendarEvent[] }> {
  const days: Date[] = []
  const last = startOfDay(to)
  for (let day = startOfDay(from); day <= last; day = addDays(day, 1)) days.push(day)

  const byDay = eventsByDay(events, days)

  return days.map(day => ({ day, events: byDay.get(toDateInput(day)) ?? [] })).filter(entry => entry.events.length > 0)
}

/** Colour for an event: its own override, else its source's. */
export function colourFor(event: CalendarEvent, sources: CalendarSource[]): string {
  if (event.colour) return event.colour

  return sources.find(source => source.id === event.sourceId)?.colour ?? '#4f8ef7'
}

/** True when the event came from a subscribed feed and cannot be edited here. */
export function isReadOnly(event: CalendarEvent, sources: CalendarSource[]): boolean {
  if (event.externalUid !== null) return true

  return sources.find(source => source.id === event.sourceId)?.readOnly ?? false
}
