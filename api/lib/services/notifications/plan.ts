/**
 * Deciding what to send, and when.
 *
 * Pure, and separated from everything that touches the database or the
 * network, because the awkward parts of notifying a household are all
 * decisions rather than plumbing: not waking anybody at three in the morning,
 * and not emptying a backlog of stale reminders onto five phones the moment a
 * Pi comes back from a power cut.
 */

export type NotificationKind = 'task-due' | 'task-overdue' | 'event-soon' | 'system-fault' | 'system-recovered'

export type Priority = 'min' | 'low' | 'default' | 'high' | 'urgent'

export interface PlannedNotification {
  kind: NotificationKind
  /** Unique per reminder *and* per moment; see the migration for the shapes. */
  key: string
  /** Which person's topic this belongs on. */
  topic: string
  title: string
  body: string
  /** When the reminder is for. */
  fireAt: Date
  priority: Priority
  tags: string[]
  /** Page to open when the notification is tapped, relative to the dashboard. */
  clickPath?: string
  /** For system faults: the error text, so an unchanged fault stays quiet. */
  detail?: string
}

export interface QuietHours {
  /** Hour the quiet window opens, 0-23. Equal values disable it. */
  from: number
  /** Hour it closes, 0-23. Wraps midnight when `to` is less than `from`. */
  to: number
}

export type Decision =
  /** Not yet - a later sweep will pick it up. */
  | { action: 'hold' }
  /** Send now. `fireAt` is the effective moment, after any quiet-hours shift. */
  | { action: 'send'; fireAt: Date }
  /**
   * The moment has passed by more than the household would want to hear
   * about. Recorded as handled so it never fires, but not delivered.
   */
  | { action: 'expire'; fireAt: Date }

/** Whether an hour falls inside the quiet window. */
export function isQuiet(hour: number, quiet: QuietHours): boolean {
  if (quiet.from === quiet.to) return false

  // A window like 21:00-07:00 wraps midnight, so the test flips.
  return quiet.from < quiet.to ? hour >= quiet.from && hour < quiet.to : hour >= quiet.from || hour < quiet.to
}

/**
 * Moves a moment out of the quiet window, to the hour it closes.
 *
 * A chore due at three in the morning is announced at seven, not at three.
 * Only the intended moment is shifted; a reminder that merely *arrives*
 * slightly after the window opens is allowed through, because holding it
 * would push it past the staleness cutoff and lose it entirely for the sake
 * of a few minutes.
 */
export function shiftOutOfQuiet(fireAt: Date, quiet: QuietHours): Date {
  if (!isQuiet(fireAt.getHours(), quiet)) return fireAt

  const shifted = new Date(fireAt)
  shifted.setMinutes(0, 0, 0)

  // Walk forward an hour at a time rather than computing the boundary: it
  // costs at most 24 steps and it cannot get a daylight-saving change wrong.
  for (let step = 0; step < 25 && isQuiet(shifted.getHours(), quiet); step++) {
    shifted.setHours(shifted.getHours() + 1)
  }

  return shifted
}

/**
 * What to do with one planned reminder.
 *
 * `staleAfterMinutes` is the rule that makes a power cut survivable. Without
 * it, a Pi that has been off overnight wakes up, finds every reminder from
 * the last twelve hours unsent, and delivers the lot.
 */
export function decide(
  planned: Pick<PlannedNotification, 'fireAt'>,
  now: Date,
  quiet: QuietHours,
  staleAfterMinutes: number
): Decision {
  const fireAt = shiftOutOfQuiet(planned.fireAt, quiet)

  if (now < fireAt) return { action: 'hold' }

  const lateMinutes = (now.getTime() - fireAt.getTime()) / 60_000

  return lateMinutes > staleAfterMinutes ? { action: 'expire', fireAt } : { action: 'send', fireAt }
}

/** A probe's current state, as the ledger remembers it. */
export interface CheckState {
  name: string
  healthy: boolean
  /** The failure text, or empty when healthy. */
  message: string
}

export interface StateChange {
  /** What to write to the ledger as this check's state. */
  detail: string
  key: string
  /** False on the very first sighting of a healthy check: record, say nothing. */
  announce: boolean
  healthy: boolean
}

/**
 * Whether a probe's state is worth a message, and under what key.
 *
 * Two things here are easy to get wrong and were:
 *
 * The key is built from the *transition*, not from the state. Keyed on the
 * state alone, a check that recovers produces exactly the key recorded when it
 * was last healthy, so the recovery is deduped against that old row and
 * nobody is ever told the problem went away. The minute stamp makes each
 * change distinct while still collapsing two sweeps that race.
 *
 * And a healthy check that has never been seen before is recorded silently.
 * Otherwise the first sweep after setting notifications up announces that all
 * nine probes are fine, which is not news.
 */
export function planStateChange(
  state: CheckState,
  previousDetail: string | null,
  now: Date,
  digest: (value: string) => string
): StateChange | null {
  const detail = state.healthy ? 'ok' : state.message || 'failing'

  if (previousDetail === detail) return null

  return {
    detail,
    key: `system:${state.name}:${digest(detail)}:${now.toISOString().slice(0, 16)}`,
    announce: previousDetail !== null || !state.healthy,
    healthy: state.healthy
  }
}
