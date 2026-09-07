import { PostgresDatabase } from '../db/PostgresDatabase'
import type { MealPlanEntry, MealSlot } from '../types/domain'
import { toDateOnly } from './rows'

interface MealPlanRow {
  id: string
  plan_date: Date | string
  slot: MealSlot
  recipe_id: string | null
  recipe_title: string | null
  custom_text: string | null
  notes: string | null
}

export interface SetMealPlan {
  planDate: string
  slot: MealSlot
  recipeId?: string | null
  customText?: string | null
  notes?: string | null
}

/**
 * `plan_date` is a `date`, deliberately: a planned meal is "Tuesday", not an
 * instant. Everything here works in 'YYYY-MM-DD' strings so no timezone can
 * shift a dinner onto the wrong day.
 */
const COLUMNS = 'p.id, p.plan_date, p.slot, p.recipe_id, r.title AS recipe_title, p.custom_text, p.notes'

export class MealPlanRepository {
  public async inRange(from: string, to: string): Promise<MealPlanEntry[]> {
    const rows = await PostgresDatabase.many<MealPlanRow>(
      `SELECT ${COLUMNS}
       FROM meal_plan p
       LEFT JOIN recipe r ON r.id = p.recipe_id
       WHERE p.plan_date >= $1::date AND p.plan_date <= $2::date
       ORDER BY p.plan_date, p.slot`,
      [from, to]
    )
    return rows.map(MealPlanRepository.toDomain)
  }

  public async onDate(planDate: string): Promise<MealPlanEntry[]> {
    return this.inRange(planDate, planDate)
  }

  /**
   * Set what is planned for one date and slot.
   *
   * The unique constraint on (plan_date, slot) makes this an upsert: picking
   * a different dinner for Tuesday replaces Tuesday's dinner rather than
   * adding a second one.
   */
  public async set(entry: SetMealPlan): Promise<MealPlanEntry | null> {
    const row = await PostgresDatabase.one<{ id: string }>(
      `INSERT INTO meal_plan (plan_date, slot, recipe_id, custom_text, notes)
       VALUES ($1::date, $2, $3, $4, $5)
       ON CONFLICT (plan_date, slot)
       DO UPDATE SET recipe_id = excluded.recipe_id,
                     custom_text = excluded.custom_text,
                     notes = excluded.notes,
                     updated_at = now()
       RETURNING id`,
      [entry.planDate, entry.slot, entry.recipeId ?? null, entry.customText ?? null, entry.notes ?? null]
    )

    if (!row) return null

    return this.byId(row.id)
  }

  public async byId(id: string): Promise<MealPlanEntry | null> {
    const row = await PostgresDatabase.one<MealPlanRow>(
      `SELECT ${COLUMNS} FROM meal_plan p LEFT JOIN recipe r ON r.id = p.recipe_id WHERE p.id = $1`,
      [id]
    )
    return row ? MealPlanRepository.toDomain(row) : null
  }

  public async clearSlot(planDate: string, slot: MealSlot): Promise<boolean> {
    return (
      (await PostgresDatabase.execute('DELETE FROM meal_plan WHERE plan_date = $1::date AND slot = $2', [
        planDate,
        slot
      ])) > 0
    )
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM meal_plan WHERE id = $1', [id])) > 0
  }

  /**
   * Copy every meal in one date range forward by a number of days.
   *
   * This is how a household actually plans a month: a rotation repeated with
   * a few swaps, not thirty separate decisions. Existing entries in the
   * destination are overwritten, so copying twice is idempotent rather than
   * doubling up.
   */
  public async copyRange(from: string, to: string, offsetDays: number): Promise<number> {
    if (offsetDays === 0) return 0

    return PostgresDatabase.transaction(async client => {
      const result = await client.query(
        `INSERT INTO meal_plan (plan_date, slot, recipe_id, custom_text, notes)
         SELECT plan_date + ($3 || ' days')::interval, slot, recipe_id, custom_text, notes
         FROM meal_plan
         WHERE plan_date >= $1::date AND plan_date <= $2::date
         ON CONFLICT (plan_date, slot)
         DO UPDATE SET recipe_id = excluded.recipe_id,
                       custom_text = excluded.custom_text,
                       notes = excluded.notes,
                       updated_at = now()`,
        [from, to, offsetDays]
      )

      return result.rowCount ?? 0
    })
  }

  /** Delete every meal in a range. Used by "clear this week". */
  public async clearRange(from: string, to: string): Promise<number> {
    return PostgresDatabase.execute('DELETE FROM meal_plan WHERE plan_date >= $1::date AND plan_date <= $2::date', [
      from,
      to
    ])
  }

  /** The recipes planned in a range, for building a shopping list. */
  public async recipeIdsInRange(from: string, to: string): Promise<string[]> {
    const rows = await PostgresDatabase.many<{ recipe_id: string }>(
      `SELECT recipe_id FROM meal_plan
       WHERE plan_date >= $1::date AND plan_date <= $2::date AND recipe_id IS NOT NULL
       ORDER BY plan_date, slot`,
      [from, to]
    )
    return rows.map(row => row.recipe_id)
  }

  private static toDomain(row: MealPlanRow): MealPlanEntry {
    return {
      id: row.id,
      // `date` comes back from pg as a Date at UTC midnight; formatting from
      // its UTC fields keeps the day it actually names.
      planDate: toDateOnly(row.plan_date),
      slot: row.slot,
      recipeId: row.recipe_id,
      recipeTitle: row.recipe_title,
      customText: row.custom_text,
      notes: row.notes
    }
  }
}
