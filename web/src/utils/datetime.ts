/**
 * Date helpers for the calendar grid and for the relative wording used on
 * task and event lists.
 *
 * All of this works in the browser's local timezone, which on the Pi is the
 * household's — "today" has to mean the day the people looking at the screen
 * are having.
 */

export const MS_PER_DAY = 86_400_000

// --- boundaries -------------------------------------------------------------

export function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

export function endOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  // setDate rather than arithmetic on the timestamp, so a daylight-saving
  // boundary does not shift the time of day.
  result.setDate(result.getDate() + days)
  return result
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()

  result.setDate(1)
  result.setMonth(result.getMonth() + months)

  // Clamp, so 31 January plus a month is 28 February rather than 3 March.
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDay))

  return result
}

export function startOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const result = startOfDay(date)
  const shift = (result.getDay() - weekStartsOn + 7) % 7
  result.setDate(result.getDate() - shift)
  return result
}

export function startOfMonth(date: Date): Date {
  const result = startOfDay(date)
  result.setDate(1)
  return result
}

export function endOfMonth(date: Date): Date {
  const result = startOfMonth(date)
  result.setMonth(result.getMonth() + 1)
  result.setDate(0)
  return endOfDay(result)
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isToday(date: Date, now = new Date()): boolean {
  return isSameDay(date, now)
}

/**
 * The six-week grid a month view shows: whole weeks covering the month, so
 * the grid never changes height between months and the layout stays still.
 */
export function monthGrid(month: Date, weekStartsOn: 0 | 1 = 0): Date[] {
  const first = startOfWeek(startOfMonth(month), weekStartsOn)

  return Array.from({ length: 42 }, (_unused, index) => addDays(first, index))
}

/** Whole days between two dates, ignoring the time of day. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY)
}

// --- formatting -------------------------------------------------------------

export function formatTime(date: Date, hour24 = true): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: hour24 ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !hour24
  }).format(date)
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(date)
}

export function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)
}

export function weekdayNames(weekStartsOn: 0 | 1 = 0): string[] {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  // Any known Sunday works as the anchor; 4 January 1970 was one.
  const anchor = new Date(1970, 0, 4)

  return Array.from({ length: 7 }, (_unused, index) => formatter.format(addDays(anchor, index + weekStartsOn)))
}

/**
 * Relative wording for a due date or an event start.
 *
 * Says "Today", "Tomorrow" and "Overdue" rather than a bare date, because
 * that is the question somebody walking past the screen is actually asking.
 */
export function formatRelativeDay(date: Date, now = new Date()): string {
  const days = daysBetween(now, date)

  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 1 && days < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date)
  if (days < -1 && days > -7) return `${Math.abs(days)} days ago`

  return formatDate(date)
}

/** "Today 19:00", "Tomorrow", "Mon 14 Sep 07:30". */
export function formatDueLabel(iso: string, options: { hour24?: boolean; allDay?: boolean } = {}): string {
  const date = new Date(iso)
  const day = formatRelativeDay(date)

  if (options.allDay) return day

  return `${day} ${formatTime(date, options.hour24 ?? true)}`
}

export function isOverdue(iso: string | null, now = new Date()): boolean {
  return iso !== null && new Date(iso) < now
}

/**
 * How an event's span reads on one line.
 *
 * All-day events carry an exclusive end (iCalendar's convention, which the
 * API preserves), so a single day shows as just the day and a multi-day span
 * counts to the day before the end.
 */
export function formatEventSpan(startsAt: string, endsAt: string, allDay: boolean, hour24 = true): string {
  // All-day events are stored at UTC midnight, which is what makes them
  // timezone-independent on the wire. They have to be read back as calendar
  // dates: interpreting 2026-09-20T00:00:00Z locally gives the 19th at 17:00
  // in Vancouver, and the span would report the wrong days.
  const asDate = (iso: string): Date => {
    const instant = new Date(iso)
    return allDay ? new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()) : instant
  }

  const start = asDate(startsAt)
  const end = asDate(endsAt)

  if (allDay) {
    const lastDay = addDays(end, -1)
    return isSameDay(start, lastDay) || end <= start
      ? 'All day'
      : `All day · ${formatDate(start)} – ${formatDate(lastDay)}`
  }

  if (isSameDay(start, end)) return `${formatTime(start, hour24)} – ${formatTime(end, hour24)}`

  return `${formatDate(start)} ${formatTime(start, hour24)} – ${formatDate(end)} ${formatTime(end, hour24)}`
}

// --- input helpers ----------------------------------------------------------

/** A Date as the value a `datetime-local` input expects. */
export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** A Date as the value a `date` input expects. */
export function toDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parses a `datetime-local` or `date` value as local time.
 *
 * `new Date('2026-09-15')` is parsed as UTC midnight by the spec, which
 * lands on the 14th for anyone in the Americas — so date-only values are
 * split and rebuilt with local components instead.
 */
export function fromDateInput(value: string): Date | null {
  if (!value) return null

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
