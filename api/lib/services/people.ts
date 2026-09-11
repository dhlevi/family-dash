/**
 * Who the household is, for the purpose of showing them their day.
 *
 * There is still no member table and no `member_id` anywhere: a task's
 * assignee is free text, and this module exists only to decide how to *show*
 * the names the household has already listed in Settings. Nothing here grants
 * anyone an account or hides anything from anybody.
 */

/**
 * Colours for the person columns.
 *
 * Picked by hand rather than generated from a hue wheel because they have to
 * be legible on both the dark and the light theme, and because a generated
 * palette reliably produces one muddy olive that nobody wants to be.
 */
export const PERSON_COLOURS = [
  '#3f8fd6',
  '#e0603f',
  '#4fa46b',
  '#a45fd6',
  '#d9a520',
  '#35a3a0',
  '#d65f9e',
  '#7b76e0',
  '#c47a35',
  '#6f8a4f'
] as const

/** Names are matched loosely, because a task's assignee is typed by hand. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase()
}

/** A small stable hash, so a person keeps their colour between restarts. */
function hash(text: string): number {
  let value = 0x811c9dc5

  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }

  return value
}

/**
 * Assigns each name a colour.
 *
 * Derived from the name so that a person's colour survives a restart and does
 * not shuffle when somebody else is added — "Skye is the green one" should
 * stay true. Where two names want the same colour the later one takes the
 * next free slot instead, because with a household of five a collision is
 * likely enough to matter and two identical columns defeat the point.
 *
 * An explicit choice in Settings always wins.
 */
export function assignColours(names: readonly string[], overrides: Record<string, string> = {}): Map<string, string> {
  const assigned = new Map<string, string>()
  const taken = new Set<string>()

  // Explicit choices are placed first so that a derived colour gives way to
  // them rather than the other way round.
  for (const name of names) {
    const chosen = overrides[name]
    if (chosen) {
      assigned.set(name, chosen)
      taken.add(chosen.toLowerCase())
    }
  }

  for (const name of names) {
    if (assigned.has(name)) continue

    const preferred = hash(normaliseName(name)) % PERSON_COLOURS.length
    let colour = PERSON_COLOURS[preferred]!

    for (let step = 1; step < PERSON_COLOURS.length && taken.has(colour.toLowerCase()); step++) {
      colour = PERSON_COLOURS[(preferred + step) % PERSON_COLOURS.length]!
    }

    assigned.set(name, colour)
    taken.add(colour.toLowerCase())
  }

  return assigned
}
