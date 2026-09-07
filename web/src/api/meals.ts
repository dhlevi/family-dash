import { api } from './client'
import type { MealPlanEntry, MealSlot, NewRecipe, Recipe, ShoppingItem, ShoppingList } from './types'

export const recipesApi = {
  list: (filter: { search?: string; tag?: string; favouritesOnly?: boolean; limit?: number } = {}) =>
    api.get<Recipe[]>('/recipes', { query: { ...filter } }),

  tags: () => api.get<string[]>('/recipes/tags'),

  get: (id: string) => api.get<Recipe>(`/recipes/${id}`),

  /** The same recipe with quantities scaled, computed by the API. */
  scaled: (id: string, servings: number) => api.get<Recipe>(`/recipes/${id}/scaled`, { query: { servings } }),

  add: (recipe: NewRecipe) => api.post<Recipe>('/recipes', recipe),

  update: (id: string, changes: Partial<NewRecipe>) => api.patch<Recipe>(`/recipes/${id}`, changes),

  remove: (id: string) => api.delete<void>(`/recipes/${id}`)
}

export const mealPlanApi = {
  /** Meals between two 'YYYY-MM-DD' dates, inclusive. */
  range: (from: string, to: string) => api.get<MealPlanEntry[]>('/meals/plan', { query: { from, to } }),

  today: (date?: string) => api.get<MealPlanEntry[]>('/meals/plan/today', { query: { date } }),

  /** Set one date and slot, replacing whatever was there. */
  set: (entry: {
    planDate: string
    slot: MealSlot
    recipeId?: string | null
    customText?: string | null
    notes?: string | null
  }) => api.put<MealPlanEntry>('/meals/plan', entry),

  clearSlot: (planDate: string, slot: MealSlot) => api.delete<void>(`/meals/plan/${planDate}/${slot}`),

  clearRange: (from: string, to: string) => api.delete<{ cleared: number }>('/meals/plan', { query: { from, to } }),

  /** "Copy this week to next week" is `offsetDays: 7`. */
  copy: (from: string, to: string, offsetDays: number) =>
    api.post<{ copied: number }>('/meals/plan/copy', { from, to, offsetDays })
}

export const shoppingApi = {
  list: () => api.get<ShoppingList>('/shopping'),

  add: (item: { name: string; quantity?: string | null; category?: string | null }) =>
    api.post<ShoppingItem>('/shopping', item),

  update: (
    id: string,
    changes: { name?: string; quantity?: string | null; category?: string | null; checked?: boolean }
  ) => api.patch<ShoppingItem>(`/shopping/${id}`, changes),

  remove: (id: string) => api.delete<void>(`/shopping/${id}`),

  clearChecked: () => api.delete<{ removed: number }>('/shopping/checked'),

  /** Rebuild the meal-plan half of the list from a date range. */
  fromPlan: (from: string, to: string) =>
    api.post<ShoppingList>('/shopping/from-plan', { from, to }, { timeoutMs: 30000 }),

  /** The outstanding items as plain text, for copying or sharing. */
  text: () => api.get<{ text: string }>('/shopping/text')
}
