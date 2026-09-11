import { advance, isRecurrence, type RecurrenceKind } from './Recurrence'
import type { CalendarEvent, DateRange } from '../types/domain'

/**
 * Turning one stored row into the occurrences that fall inside a range.
 *
 * A local repeating event is stored once, as the first occurrence plus a rule,
 * and expanded whenever it is read. The alternative — writing a row per
 * occurrence, as the feed sync does — needs a horizon, a job to keep the
 * horizon topped up, and leaves stale copies behind whenever the series is
 * edited. A feed is a cache of somebody else's authority and is right to work
 * that way; a local series *is* the authority.
 *
 * All-day events advance by whole UTC days and timed events by local time, and
 * the difference is not pedantry. An all-day event is stored at UTC midnight
 * so that it means the same calendar date everywhere; advancing it in local
 * time would shift it off midnight the first time the clocks changed. A timed
 * event is the opposite case: swimming at 17:00 stays at 17:00 across a
 * daylight-saving change, which adding fixed 24-hour spans would not do.
 */

/**
 * How many occurrences a single series may contribute before the walk gives
 * up. A daily event queried over the calendar's widest window is a few hundred;
 * this is far above that and exists so a corrupt start date cannot spin.
 */
const MAX_OCCURRENCES = 2000

/** Separator between a series id and an occurrence's start. */
const SEPARATOR = '::'

/**
 * The id of one occurrence.
 *
 * Composite rather than stored, because the occurrence has no row of its own.
 * The same shape the feed sync already uses for expanded ICS events, so the
 * two kinds of repeating event read alike.
 */
export function occurrenceId(seriesId: string, startsAt: Date): string {
  return `${seriesId}${SEPARATOR}${startsAt.toISOString()}`
}

export interface ParsedOccurrenceId {
  seriesId: string
  startsAt: Date
}

/** Splits an occurrence id, or returns null if it is an ordinary event id. */
export function parseOccurrenceId(id: string): ParsedOccurrenceId | null {
  const at = id.indexOf(SEPARATOR)
  if (at === -1) return null

  const startsAt = new Date(id.slice(at + SEPARATOR.length))
  if (Number.isNaN(startsAt.getTime())) return null

  return { seriesId: id.slice(0, at), startsAt }
}

/** The intervals that are exact when chained; monthly is anchored instead. */
type SteppedRecurrence = Exclude<RecurrenceKind, 'monthly'>

/** Whole-UTC-day arithmetic, for all-day events pinned to UTC midnight. */
function advanceUtc(recurrence: SteppedRecurrence, from: Date): Date {
  const next = new Date(from.getTime())

  switch (recurrence) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1)
      return next

    case 'weekdays':
      do {
        next.setUTCDate(next.getUTCDate() + 1)
      } while (next.getUTCDay() === 0 || next.getUTCDay() === 6)
      return next

    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7)
      return next

    case 'fortnightly':
      next.setUTCDate(next.getUTCDate() + 14)
      return next
  }
}

function step(recurrence: SteppedRecurrence, from: Date, allDay: boolean): Date {
  return allDay ? advanceUtc(recurrence, from) : advance(recurrence, from)
}

/**
 * The start of the `count`-th month after `from`, clamped to the month's end.
 *
 * Monthly occurrences are measured from the series start rather than chained
 * off the one before, and the difference shows the first time the series
 * passes a short month: chaining takes "the 31st of every month" through
 * 28 February and then leaves it on the 28th for ever. Anchoring keeps it on
 * the 31st and only borrows February.
 *
 * The other intervals are exact under chaining and are deliberately left that
 * way — a weekly event must stay at the same *local* time across a clock
 * change, which advancing by a fixed span from the start would not do.
 */
function addMonths(from: Date, count: number, allDay: boolean): Date {
  const next = new Date(from.getTime())

  if (allDay) {
    const day = from.getUTCDate()
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth() + count)

    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
    next.setUTCDate(Math.min(day, lastDay))
    return next
  }

  const day = from.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + count)

  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

/**
 * Every occurrence of `event` that overlaps `range`.
 *
 * A non-repeating event returns itself, so callers do not have to branch. The
 * first occurrence keeps the stored row's own id: it is the one the editor
 * opens, and giving it a composite id would make a one-off and the first of a
 * series behave differently for no reason.
 */
export function expand(event: CalendarEvent, range: DateRange, excluded: readonly Date[] = []): CalendarEvent[] {
  if (!isRecurrence(event.recurrence)) {
    // Kept for symmetry with the expanded case: callers filter nothing.
    const starts = new Date(event.startsAt)
    const ends = new Date(event.endsAt)

    return starts < range.to && ends >= range.from ? [event] : []
  }

  const first = new Date(event.startsAt)
  const durationMs = new Date(event.endsAt).getTime() - first.getTime()
  const until = event.recurrenceUntil ? new Date(event.recurrenceUntil) : null
  const skipped = new Set(excluded.map(date => date.getTime()))

  const occurrences: CalendarEvent[] = []
  let starts = first

  for (let index = 0; index < MAX_OCCURRENCES; index++) {
    if (until && starts > until) break
    // The walk is forward in time, so once an occurrence begins after the
    // range there is nothing further to find.
    if (starts >= range.to) break

    const ends = new Date(starts.getTime() + durationMs)

    if (ends >= range.from && !skipped.has(starts.getTime())) {
      const isFirst = starts.getTime() === first.getTime()

      occurrences.push({
        ...event,
        id: isFirst ? event.id : occurrenceId(event.id, starts),
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        seriesId: event.id
      })
    }

    starts =
      event.recurrence === 'monthly'
        ? addMonths(first, index + 1, event.allDay)
        : step(event.recurrence, starts, event.allDay)
  }

  return occurrences
}

/** Expands a list of stored rows, newest-sorted the way a range query is. */
export function expandAll(
  events: readonly CalendarEvent[],
  range: DateRange,
  exclusions: ReadonlyMap<string, Date[]> = new Map()
): CalendarEvent[] {
  return events
    .flatMap(event => expand(event, range, exclusions.get(event.id) ?? []))
    .sort((a, b) => {
      // Matching the SQL: all-day first, then by start, then by title.
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1
      return a.title.localeCompare(b.title)
    })
}
