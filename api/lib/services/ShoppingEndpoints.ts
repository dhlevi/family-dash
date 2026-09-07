import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { MealPlanRepository } from '../repositories/MealPlanRepository'
import { RecipeRepository } from '../repositories/RecipeRepository'
import { ShoppingItemRepository } from '../repositories/ShoppingItemRepository'
import { categoriseIngredient, describeIngredient, mergeIngredients } from './Ingredients'
import type { ShoppingItem } from '../types/domain'

const items = new ShoppingItemRepository()
const plans = new MealPlanRepository()
const recipes = new RecipeRepository()

const planDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be written as 'YYYY-MM-DD'")

const newItemSchema = z.object({
  name: z.string().trim().min(1, 'An item needs a name').max(200),
  quantity: z.string().trim().max(40).nullish(),
  category: z.string().trim().max(60).nullish()
})

const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  quantity: z.string().trim().max(40).nullish(),
  category: z.string().trim().max(60).nullish(),
  checked: z.boolean().optional()
})

const fromPlanSchema = z.object({ from: planDate, to: planDate })

export interface ShoppingListSummary {
  items: ShoppingItem[]
  total: number
  remaining: number
}

export class ShoppingEndpoints {
  public async list(): Promise<ShoppingListSummary> {
    const [all, counts] = await Promise.all([items.all(), items.counts()])
    return { items: all, ...counts }
  }

  public async add(body: unknown): Promise<ShoppingItem> {
    const parsed = newItemSchema.parse(body)

    return items.create({
      name: parsed.name,
      quantity: parsed.quantity?.trim() || null,
      // Guess an aisle when none is given, so a manually added item files
      // itself alongside the ones the meal plan produced.
      category: parsed.category?.trim() || categoriseIngredient(parsed.name),
      origin: 'manual'
    })
  }

  public async update(id: string, body: unknown): Promise<ShoppingItem> {
    const parsed = itemUpdateSchema.parse(body)

    const updated = await items.update(id, {
      name: parsed.name,
      quantity: parsed.quantity === undefined ? undefined : (parsed.quantity?.trim() ?? null),
      category: parsed.category === undefined ? undefined : (parsed.category?.trim() ?? null),
      checked: parsed.checked
    })

    if (!updated) throw ApiError.notFound(`No shopping item with id '${id}'`)
    return updated
  }

  public async remove(id: string): Promise<void> {
    if (!(await items.remove(id))) throw ApiError.notFound(`No shopping item with id '${id}'`)
  }

  public async clearChecked(): Promise<{ removed: number }> {
    return { removed: await items.removeChecked() }
  }

  /**
   * Rebuild the meal-plan half of the list from what is planned in a range.
   *
   * Ingredients from every planned recipe are merged, so a week that uses
   * flour three times produces one line with the total rather than three
   * lines to reconcile in a supermarket. Manually added items are untouched,
   * and anything already ticked off keeps its tick.
   */
  public async generateFromPlan(body: unknown): Promise<ShoppingListSummary> {
    const parsed = fromPlanSchema.parse(body)
    if (parsed.to < parsed.from) throw ApiError.badRequest("'to' must not be before 'from'")

    const recipeIds = await plans.recipeIdsInRange(parsed.from, parsed.to)

    if (recipeIds.length === 0) {
      // Nothing planned: clear the generated half rather than leaving last
      // week's list looking like this week's.
      await items.replaceFromMealPlan([])
      return this.list()
    }

    const planned = await recipes.byIds([...new Set(recipeIds)])
    const byId = new Map(planned.map(recipe => [recipe.id, recipe]))

    // Walk the plan rather than the recipe set, so a recipe cooked twice in
    // the week contributes its ingredients twice.
    const entries = recipeIds.flatMap(recipeId => {
      const recipe = byId.get(recipeId)
      if (!recipe) return []

      return recipe.ingredients.map(ingredient => ({ ingredient, source: recipe.title }))
    })

    const merged = mergeIngredients(entries)

    await items.replaceFromMealPlan(
      merged.map(line => ({
        name: [line.unit, line.item].filter(Boolean).join(' ').trim() || line.item,
        quantity: line.quantity,
        category: categoriseIngredient(line.item),
        origin: 'meal_plan' as const,
        // A line merged from several recipes belongs to none of them in
        // particular, so the link is only kept when it is unambiguous.
        recipeId: line.sources.length === 1 ? (planned.find(r => r.title === line.sources[0])?.id ?? null) : null
      }))
    )

    return this.list()
  }

  /**
   * The list as plain text, for the "copy" and "share" buttons.
   *
   * Grouped by aisle and ticked items omitted — it is meant to be pasted
   * into a message to whoever is at the shop.
   */
  public async asText(): Promise<{ text: string }> {
    const all = await items.all()
    const outstanding = all.filter(item => !item.checked)

    if (outstanding.length === 0) return { text: 'Shopping list: nothing needed.' }

    const byCategory = new Map<string, ShoppingItem[]>()
    for (const item of outstanding) {
      const key = item.category ?? 'Other'
      byCategory.set(key, [...(byCategory.get(key) ?? []), item])
    }

    const lines = ['Shopping list', '']
    for (const [category, group] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${category}:`)
      for (const item of group) {
        lines.push(`  - ${describeIngredient({ quantity: item.quantity, unit: null, item: item.name })}`)
      }
      lines.push('')
    }

    return { text: lines.join('\n').trim() }
  }
}
