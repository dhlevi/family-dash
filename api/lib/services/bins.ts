/**
 * Working out what goes to the curb, and when.
 *
 * Collection schedules arrive as ordinary calendar events, because that is how
 * most councils and municipalities publish them. An ICS feed the app already
 * knows how to subscribe to and sync. Nothing here fetches anything; it reads
 * events that are already cached and decides what they mean.
 *
 * The classification is best-effort and the widget always shows the event's
 * own title alongside it. That is deliberate: titles vary enormously between
 * authorities, and a wrong guess should cost an icon, never the information.
 */

export const BIN_KINDS = ['garbage', 'recycling', 'organics', 'yard', 'glass'] as const

export type BinKind = (typeof BIN_KINDS)[number]

/**
 * Patterns per kind, checked in this order.
 *
 * Order matters because titles overlap: "Yard Waste" must not be read as
 * general waste, so bare "waste" is never a keyword, only the phrases that
 * unambiguously mean landfill are.
 *
 * Bin colours are only matched where they mean the same thing on both sides
 * of the Atlantic. Blue is recycling and black is landfill essentially
 * everywhere. Green is not: a green bin is food waste across most of Canada
 * and garden waste across much of the UK. It is mapped to organics here,
 * which suits this household, and the title is on screen either way.
 */
const RULES: ReadonlyArray<{ kind: BinKind; patterns: readonly RegExp[] }> = [
  {
    kind: 'yard',
    patterns: [/\byard\b/, /\bgarden\b/, /\bgreen waste\b/, /\btrimmings\b/, /\bbrown bin\b/, /\bleaf\b/]
  },
  {
    kind: 'organics',
    patterns: [/\borganics?\b/, /\bfood\b/, /\bcompost\w*/, /\bgreen (?:bin|cart|box)\b/, /\bcaddy\b/, /\bfogo\b/]
  },
  {
    kind: 'recycling',
    patterns: [/\brecycl\w*/, /\bblue (?:box|bin|bag|cart)\b/, /\bcardboard\b/, /\bpaper\b/, /\bcontainers?\b/]
  },
  { kind: 'glass', patterns: [/\bglass\b/] },
  {
    kind: 'garbage',
    patterns: [
      /\bgarbage\b/,
      /\btrash\b/,
      /\brefuse\b/,
      /\brubbish\b/,
      /\blandfill\b/,
      /\b(?:general|household|residual) waste\b/,
      /\bblack (?:bin|bag|cart)\b/
    ]
  }
]

/** Canonical display order, so two collections never list their kinds differently. */
const ORDER: readonly BinKind[] = ['garbage', 'recycling', 'organics', 'yard', 'glass']

/**
 * Which bins a calendar event is about, or an empty list if it is not about
 * bins at all, which is how an ordinary appointment in the same calendar is
 * kept out of the widget.
 */
export function classify(title: string): BinKind[] {
  const text = title.toLowerCase()
  const found = new Set<BinKind>()

  for (const rule of RULES) {
    if (rule.patterns.some(pattern => pattern.test(text))) found.add(rule.kind)
  }

  return ORDER.filter(kind => found.has(kind))
}

export interface BinCollection {
  /** The local calendar day, as 'YYYY-MM-DD'. */
  date: string
  kinds: BinKind[]
  /** The events' own titles, shown when the guess is thin or simply wrong. */
  titles: string[]
}

/** An event as this module needs it, so nothing here depends on the database. */
export interface DatedTitle {
  title: string
  startsAt: Date
  /**
   * All-day events are stored at UTC midnight so that they mean the same
   * calendar date everywhere, which changes how the date must be read.
   */
  allDay: boolean
}

/** The local calendar day of an instant, in the timezone the process runs in. */
export function localDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * The calendar day an event is *about*.
 */
export function dayOf(event: DatedTitle): string {
  if (!event.allDay) return localDay(event.startsAt)

  const year = event.startsAt.getUTCFullYear()
  const month = String(event.startsAt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(event.startsAt.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * Groups bin events into one entry per day, earliest first.
 *
 * Councils commonly publish each stream as its own event on the same morning,
 * so "Garbage" and "Food Scraps & Yard Waste" on a Thursday are one trip to
 * the curb and should read as one. Events that classify to nothing are
 * dropped here rather than filtered by the caller, so an ordinary appointment
 * sharing the calendar cannot appear as a mystery collection.
 */
export function groupByDay(events: readonly DatedTitle[]): BinCollection[] {
  const days = new Map<string, BinCollection>()

  for (const event of events) {
    const kinds = classify(event.title)
    if (kinds.length === 0) continue

    const date = dayOf(event)
    const existing = days.get(date)

    if (!existing) {
      days.set(date, { date, kinds: [...kinds], titles: [event.title] })
      continue
    }

    existing.kinds = ORDER.filter(kind => existing.kinds.includes(kind) || kinds.includes(kind))
    if (!existing.titles.includes(event.title)) existing.titles.push(event.title)
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * How a collection should be announced.
 *
 * "Tonight" is the only one of these that is a *job* rather than a fact, and
 * it is the whole reason the widget exists: a reminder the morning of is too
 * late, and one three days out is noise. It appears once the evening hour has
 * passed on the day before.
 */
export type BinUrgency = 'tonight' | 'today' | 'tomorrow' | 'upcoming'

export function urgencyFor(collection: BinCollection, now: Date, eveningHour: number): BinUrgency {
  const today = localDay(now)
  if (collection.date <= today) return 'today'

  const tomorrow = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  if (collection.date !== tomorrow) return 'upcoming'

  return now.getHours() >= eveningHour ? 'tonight' : 'tomorrow'
}
