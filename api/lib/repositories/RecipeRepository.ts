import { PostgresDatabase } from '../db/PostgresDatabase'
import type { Ingredient, Recipe } from '../types/domain'
import { buildUpdate, toIsoRequired } from './rows'

interface RecipeRow {
  id: string
  title: string
  description: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  ingredients: Ingredient[]
  steps: string[]
  tags: string[]
  image_path: string | null
  source_url: string | null
  favourite: boolean
  created_at: Date
  updated_at: Date
}

export interface NewRecipe {
  title: string
  description?: string | null
  servings?: number | null
  prepMinutes?: number | null
  cookMinutes?: number | null
  ingredients?: Ingredient[]
  steps?: string[]
  tags?: string[]
  sourceUrl?: string | null
  favourite?: boolean
}

export type RecipeUpdate = Partial<NewRecipe>

export interface RecipeFilter {
  search?: string
  tag?: string
  favouritesOnly?: boolean
  limit?: number
}

const COLUMNS =
  'id, title, description, servings, prep_minutes, cook_minutes, ingredients, steps, tags, ' +
  'image_path, source_url, favourite, created_at, updated_at'

export class RecipeRepository {
  public async list(filter: RecipeFilter = {}): Promise<Recipe[]> {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.search && filter.search.trim().length > 0) {
      params.push(`%${filter.search.trim()}%`)
      // Match the title or anything in the ingredient list, so "chicken"
      // finds recipes that use chicken as well as ones named for it.
      conditions.push(`(title ILIKE $${params.length} OR ingredients::text ILIKE $${params.length})`)
    }

    if (filter.tag) {
      params.push(filter.tag)
      conditions.push(`$${params.length} = ANY(tags)`)
    }

    if (filter.favouritesOnly) conditions.push('favourite')

    let limitClause = ''
    if (filter.limit !== undefined) {
      params.push(Math.min(Math.max(filter.limit, 1), 500))
      limitClause = `LIMIT $${params.length}`
    }

    const rows = await PostgresDatabase.many<RecipeRow>(
      `SELECT ${COLUMNS} FROM recipe
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY favourite DESC, lower(title)
       ${limitClause}`,
      params
    )

    return rows.map(RecipeRepository.toDomain)
  }

  public async byId(id: string): Promise<Recipe | null> {
    const row = await PostgresDatabase.one<RecipeRow>(`SELECT ${COLUMNS} FROM recipe WHERE id = $1`, [id])
    return row ? RecipeRepository.toDomain(row) : null
  }

  public async byIds(ids: string[]): Promise<Recipe[]> {
    if (ids.length === 0) return []

    const rows = await PostgresDatabase.many<RecipeRow>(`SELECT ${COLUMNS} FROM recipe WHERE id = ANY($1::uuid[])`, [
      ids
    ])
    return rows.map(RecipeRepository.toDomain)
  }

  /** Every tag in use, for the filter row on the recipe library. */
  public async tags(): Promise<string[]> {
    const rows = await PostgresDatabase.many<{ tag: string }>(
      'SELECT DISTINCT unnest(tags) AS tag FROM recipe ORDER BY tag'
    )
    return rows.map(row => row.tag)
  }

  public async create(recipe: NewRecipe): Promise<Recipe> {
    const row = await PostgresDatabase.one<RecipeRow>(
      `INSERT INTO recipe (title, description, servings, prep_minutes, cook_minutes,
                           ingredients, steps, tags, source_url, favourite)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
       RETURNING ${COLUMNS}`,
      [
        recipe.title,
        recipe.description ?? null,
        recipe.servings ?? null,
        recipe.prepMinutes ?? null,
        recipe.cookMinutes ?? null,
        JSON.stringify(recipe.ingredients ?? []),
        JSON.stringify(recipe.steps ?? []),
        recipe.tags ?? [],
        recipe.sourceUrl ?? null,
        recipe.favourite ?? false
      ]
    )
    return RecipeRepository.toDomain(row as RecipeRow)
  }

  public async update(id: string, changes: RecipeUpdate): Promise<Recipe | null> {
    const { clause, params } = buildUpdate(
      {
        title: changes.title,
        description: changes.description,
        servings: changes.servings,
        prep_minutes: changes.prepMinutes,
        cook_minutes: changes.cookMinutes,
        ingredients: changes.ingredients === undefined ? undefined : JSON.stringify(changes.ingredients),
        steps: changes.steps === undefined ? undefined : JSON.stringify(changes.steps),
        tags: changes.tags,
        source_url: changes.sourceUrl,
        favourite: changes.favourite
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<RecipeRow>(
      `UPDATE recipe SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? RecipeRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    // Meal plan entries reference the recipe with ON DELETE SET NULL, so a
    // planned meal survives its recipe being deleted rather than vanishing
    // from the week.
    return (await PostgresDatabase.execute('DELETE FROM recipe WHERE id = $1', [id])) > 0
  }

  public async count(): Promise<number> {
    const row = await PostgresDatabase.one<{ count: string }>('SELECT count(*)::text AS count FROM recipe')
    return Number(row?.count ?? 0)
  }

  private static toDomain(row: RecipeRow): Recipe {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      servings: row.servings,
      prepMinutes: row.prep_minutes,
      cookMinutes: row.cook_minutes,
      ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
      steps: Array.isArray(row.steps) ? row.steps : [],
      tags: row.tags ?? [],
      imagePath: row.image_path,
      sourceUrl: row.source_url,
      favourite: row.favourite,
      createdAt: toIsoRequired(row.created_at),
      updatedAt: toIsoRequired(row.updated_at)
    }
  }
}
