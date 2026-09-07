import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { MealPlanRepository } from '../repositories/MealPlanRepository'
import { MEAL_SLOTS, type MealPlanEntry, type MealSlot } from '../types/domain'

const plans = new MealPlanRepository()

/** A plain calendar date. Meals are planned for days, not instants. */
const planDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be written as 'YYYY-MM-DD'")

const setPlanSchema = z
  .object({
    planDate,
    slot: z.enum(MEAL_SLOTS),
    recipeId: z.string().uuid().nullish(),
    customText: z.string().trim().max(200).nullish(),
    notes: z.string().trim().max(1000).nullish()
  })
  .refine(entry => Boolean(entry.recipeId) || Boolean(entry.customText?.trim()), {
    message: 'Choose a recipe, or write what you are having',
    path: ['recipeId']
  })

const copySchema = z.object({
  from: planDate,
  to: planDate,
  /** Whole days to shift by. Seven copies a week onto the next. */
  offsetDays: z
    .number()
    .int()
    .refine(days => days !== 0, 'Copying zero days ahead would do nothing')
})

/** Guards a range from being wide enough to return a year of rows. */
const MAX_RANGE_DAYS = 120

export class MealPlanEndpoints {
  public async range(from?: string, to?: string): Promise<MealPlanEntry[]> {
    const { start, end } = MealPlanEndpoints.parseRange(from, to)
    return plans.inRange(start, end)
  }

  /** What is planned for today, for the dashboard widget. */
  public async today(date?: string): Promise<MealPlanEntry[]> {
    const day = date ?? MealPlanEndpoints.todayString()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw ApiError.badRequest(`'${day}' is not a date`)

    return plans.onDate(day)
  }

  public async set(body: unknown): Promise<MealPlanEntry> {
    const parsed = setPlanSchema.parse(body)

    const entry = await plans.set({
      planDate: parsed.planDate,
      slot: parsed.slot,
      recipeId: parsed.recipeId ?? null,
      // A recipe and free text are mutually exclusive: showing both in one
      // slot would leave it ambiguous what is actually for dinner.
      customText: parsed.recipeId ? null : (parsed.customText?.trim() ?? null),
      notes: parsed.notes?.trim() ?? null
    })

    if (!entry) throw ApiError.internal('Could not save the meal')
    return entry
  }

  public async clearSlot(date: string, slot: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest(`'${date}' is not a date`)
    if (!(MEAL_SLOTS as readonly string[]).includes(slot)) {
      throw ApiError.badRequest(`'${slot}' is not a meal`, { slots: MEAL_SLOTS })
    }

    if (!(await plans.clearSlot(date, slot as MealSlot))) {
      throw ApiError.notFound(`Nothing is planned for ${slot} on ${date}`)
    }
  }

  /**
   * Copy a range of days forward.
   *
   * The usual case is "copy this week to next week", which is how a month of
   * meals actually gets planned. Existing meals in the destination are
   * overwritten, so running it twice leaves the same result.
   */
  public async copy(body: unknown): Promise<{ copied: number }> {
    const parsed = copySchema.parse(body)
    const { start, end } = MealPlanEndpoints.parseRange(parsed.from, parsed.to)

    return { copied: await plans.copyRange(start, end, parsed.offsetDays) }
  }

  public async clearRange(from?: string, to?: string): Promise<{ cleared: number }> {
    const { start, end } = MealPlanEndpoints.parseRange(from, to)
    return { cleared: await plans.clearRange(start, end) }
  }

  private static parseRange(from?: string, to?: string): { start: string; end: string } {
    const start = from ?? MealPlanEndpoints.todayString()
    const end = to ?? start

    for (const value of [start, end]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw ApiError.badRequest(`'${value}' is not a date`)
    }
    if (end < start) throw ApiError.badRequest("'to' must not be before 'from'")

    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
    if (days > MAX_RANGE_DAYS) {
      throw ApiError.badRequest(`Requested range is longer than ${MAX_RANGE_DAYS} days`)
    }

    return { start, end }
  }

  /**
   * Today in the container's timezone, which is the household's — "what's
   * for dinner tonight" has to mean the day the people looking are having.
   */
  private static todayString(): string {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')

    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }
}
