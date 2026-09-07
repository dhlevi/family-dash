/**
 * Recurrence for chores.
 *
 * Deliberately a short list of named intervals rather than full RRULE
 * support: household chores are "every day", "school days", "every week",
 * and the vocabulary of an RRULE would be a worse fit for a touchscreen than
 * five buttons. Subscribed calendar feeds still get proper RRULE expansion —
 * that is a different problem, handled in IcsProvider.
 *
 * Arithmetic uses local-time methods on purpose. The container's TZ is the
 * household's timezone, and "bins out at 7pm every Monday" must stay at 7pm
 * across a daylight-saving change — which adding fixed 24-hour spans in UTC
 * would not do.
 */
export const RECURRENCES = ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly'] as const

export type RecurrenceKind = (typeof RECURRENCES)[number]

export function isRecurrence(value: unknown): value is RecurrenceKind {
  return typeof value === 'string' && (RECURRENCES as readonly string[]).includes(value)
}

/** Human label for the UI, so the wording lives in one place. */
export function describeRecurrence(recurrence: RecurrenceKind): string {
  switch (recurrence) {
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Every weekday'
    case 'weekly':
      return 'Every week'
    case 'fortnightly':
      return 'Every two weeks'
    case 'monthly':
      return 'Every month'
  }
}

/**
 * The next due date for a recurring task.
 *
 * `after` is normally the completed task's due date, so a weekly chore stays
 * on its day whenever it actually gets ticked off. If that would still be in
 * the past — a chore left undone for a fortnight — it advances until it is
 * in the future, otherwise completing an overdue task would immediately
 * produce another overdue one.
 *
 * Returns null when the task does not recur.
 */
export function nextOccurrence(recurrence: string | null, after: Date, now = new Date()): Date | null {
  if (!isRecurrence(recurrence)) return null

  let next = advance(recurrence, after)

  // Bounded so a corrupt date cannot spin here. 500 steps is over a year of
  // daily chores and 40 years of monthly ones.
  let guard = 0
  while (next <= now && guard++ < 500) {
    next = advance(recurrence, next)
  }

  return next
}

function advance(recurrence: RecurrenceKind, from: Date): Date {
  const next = new Date(from.getTime())

  switch (recurrence) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      return next

    case 'weekdays':
      // Friday's next occurrence is Monday, not Saturday.
      do {
        next.setDate(next.getDate() + 1)
      } while (isWeekend(next))
      return next

    case 'weekly':
      next.setDate(next.getDate() + 7)
      return next

    case 'fortnightly':
      next.setDate(next.getDate() + 14)
      return next

    case 'monthly':
      return addMonth(next)
  }
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * Adds a month, clamping to the end of the target month.
 *
 * Without the clamp, 31 January plus a month lands on 3 March, and a monthly
 * chore set on the 31st would drift a few days later every month.
 */
function addMonth(date: Date): Date {
  const day = date.getDate()

  // Move to the 1st first, so setMonth cannot overflow into the month after.
  date.setDate(1)
  date.setMonth(date.getMonth() + 1)

  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDayOfMonth))

  return date
}
