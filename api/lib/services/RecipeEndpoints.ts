import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { RecipeRepository } from '../repositories/RecipeRepository'
import { scaleIngredients } from './Ingredients'
import type { Ingredient, Recipe } from '../types/domain'

const recipes = new RecipeRepository()

const ingredientSchema = z.object({
  quantity: z.string().trim().max(40).nullish(),
  unit: z.string().trim().max(40).nullish(),
  item: z.string().trim().min(1, 'An ingredient needs a name').max(200)
})

const newRecipeSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(200),
  description: z.string().trim().max(4000).nullish(),
  servings: z.number().int().min(1).max(100).nullish(),
  prepMinutes: z.number().int().min(0).max(6000).nullish(),
  cookMinutes: z.number().int().min(0).max(6000).nullish(),
  ingredients: z.array(ingredientSchema).max(200).optional(),
  steps: z.array(z.string().trim().max(2000)).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  sourceUrl: z.string().trim().url('Must be a URL').max(500).nullish().or(z.literal('')),
  favourite: z.boolean().optional()
})

const recipeUpdateSchema = newRecipeSchema.partial()

/**
 * Zod's `.nullish()` admits `undefined`, but an ingredient's optional fields
 * are explicitly nullable — so absent and empty both become null here rather
 * than reaching the database as undefined.
 */
function toIngredients(
  rows: Array<{ quantity?: string | null; unit?: string | null; item: string }> | undefined
): Ingredient[] | undefined {
  if (rows === undefined) return undefined

  return rows
    .filter(row => row.item.trim().length > 0)
    .map(row => ({
      quantity: row.quantity?.trim() || null,
      unit: row.unit?.trim() || null,
      item: row.item.trim()
    }))
}

export class RecipeEndpoints {
  public async list(search?: string, tag?: string, favouritesOnly?: boolean, limit?: number): Promise<Recipe[]> {
    return recipes.list({ search, tag, favouritesOnly, limit })
  }

  public async byId(id: string): Promise<Recipe> {
    const recipe = await recipes.byId(id)
    if (!recipe) throw ApiError.notFound(`No recipe with id '${id}'`)
    return recipe
  }

  /**
   * A recipe with its quantities scaled to a different number of servings.
   *
   * Done here rather than in the browser so the arithmetic — and the
   * fraction formatting that makes it readable — lives in one place.
   */
  public async scaled(id: string, servings: number): Promise<Recipe> {
    const recipe = await this.byId(id)

    if (!recipe.servings || recipe.servings <= 0) {
      throw ApiError.badRequest('That recipe does not say how many it serves, so it cannot be scaled')
    }
    if (!Number.isFinite(servings) || servings <= 0 || servings > 100) {
      throw ApiError.badRequest('Servings must be between 1 and 100')
    }

    return {
      ...recipe,
      servings,
      ingredients: scaleIngredients(recipe.ingredients, servings / recipe.servings)
    }
  }

  public async tags(): Promise<string[]> {
    return recipes.tags()
  }

  public async create(body: unknown): Promise<Recipe> {
    const parsed = newRecipeSchema.parse(body)

    return recipes.create({
      ...parsed,
      sourceUrl: parsed.sourceUrl === '' ? null : parsed.sourceUrl,
      // Drop blank rows the editor leaves behind rather than storing them.
      ingredients: toIngredients(parsed.ingredients),
      steps: parsed.steps?.filter(step => step.trim().length > 0)
    })
  }

  public async update(id: string, body: unknown): Promise<Recipe> {
    const parsed = recipeUpdateSchema.parse(body)

    const updated = await recipes.update(id, {
      ...parsed,
      sourceUrl: parsed.sourceUrl === '' ? null : parsed.sourceUrl,
      ingredients: toIngredients(parsed.ingredients),
      steps: parsed.steps?.filter(step => step.trim().length > 0)
    })

    if (!updated) throw ApiError.notFound(`No recipe with id '${id}'`)
    return updated
  }

  public async remove(id: string): Promise<void> {
    if (!(await recipes.remove(id))) throw ApiError.notFound(`No recipe with id '${id}'`)
  }
}
