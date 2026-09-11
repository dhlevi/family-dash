/**
 * Small helpers shared by the repositories when turning database rows into
 * domain objects.
 *
 * Mapping is written out explicitly in each repository rather than done
 * generically: a snake_case-to-camelCase reflection pass would be shorter but
 * would silently pass through any column added later, which is how a
 * credential ends up in an API response.
 */

/** `timestamptz` arrives from `pg` as a Date. */
export function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** Same, for columns that are NOT NULL. */
export function toIsoRequired(value: Date): string {
  return value.toISOString()
}

/** A `date` column, kept as a plain 'YYYY-MM-DD' with no timezone shift. */
export function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)

  // `date` has no time or zone, so format from the UTC fields.
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * Builds the `SET` clause of an UPDATE from the fields a caller actually
 * supplied, so a PATCH with one field does not overwrite the rest with nulls.
 *
 * Returns the clause and the ordered parameters, with placeholders starting
 * after `startIndex`.
 */
export function buildUpdate(columns: Record<string, unknown>, startIndex = 1): { clause: string; params: unknown[] } {
  const assignments: string[] = []
  const params: unknown[] = []

  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue
    params.push(value)
    assignments.push(`${column} = $${startIndex + params.length - 1}`)
  }

  return { clause: assignments.join(', '), params }
}
