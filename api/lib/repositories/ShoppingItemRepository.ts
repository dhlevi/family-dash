import { PostgresDatabase } from '../db/PostgresDatabase'
import type { ShoppingItem, ShoppingOrigin } from '../types/domain'
import { buildUpdate, toIsoRequired } from './rows'

interface ShoppingItemRow {
  id: string
  name: string
  quantity: string | null
  category: string | null
  checked: boolean
  origin: ShoppingOrigin
  recipe_id: string | null
  created_at: Date
  updated_at: Date
}

export interface NewShoppingItem {
  name: string
  quantity?: string | null
  category?: string | null
  origin?: ShoppingOrigin
  recipeId?: string | null
  checked?: boolean
}

export interface ShoppingItemUpdate {
  name?: string
  quantity?: string | null
  category?: string | null
  checked?: boolean
}

const COLUMNS = 'id, name, quantity, category, checked, origin, recipe_id, created_at, updated_at'

export class ShoppingItemRepository {
  /**
   * The whole list, unchecked first.
   *
   * Grouping by category happens in the UI; the ordering here puts what is
   * still needed above what is already in the trolley, which is the order it
   * is read in while shopping.
   */
  public async all(): Promise<ShoppingItem[]> {
    const rows = await PostgresDatabase.many<ShoppingItemRow>(
      `SELECT ${COLUMNS} FROM shopping_item ORDER BY checked, category NULLS LAST, lower(name)`
    )
    return rows.map(ShoppingItemRepository.toDomain)
  }

  public async byId(id: string): Promise<ShoppingItem | null> {
    const row = await PostgresDatabase.one<ShoppingItemRow>(`SELECT ${COLUMNS} FROM shopping_item WHERE id = $1`, [id])
    return row ? ShoppingItemRepository.toDomain(row) : null
  }

  public async create(item: NewShoppingItem): Promise<ShoppingItem> {
    const row = await PostgresDatabase.one<ShoppingItemRow>(
      `INSERT INTO shopping_item (name, quantity, category, origin, recipe_id, checked)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        item.name,
        item.quantity ?? null,
        item.category ?? null,
        item.origin ?? 'manual',
        item.recipeId ?? null,
        item.checked ?? false
      ]
    )
    return ShoppingItemRepository.toDomain(row as ShoppingItemRow)
  }

  public async update(id: string, changes: ShoppingItemUpdate): Promise<ShoppingItem | null> {
    const { clause, params } = buildUpdate(
      {
        name: changes.name,
        quantity: changes.quantity,
        category: changes.category,
        checked: changes.checked
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<ShoppingItemRow>(
      `UPDATE shopping_item SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? ShoppingItemRepository.toDomain(row) : null
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM shopping_item WHERE id = $1', [id])) > 0
  }

  /** Clear everything already in the trolley. */
  public async removeChecked(): Promise<number> {
    return PostgresDatabase.execute('DELETE FROM shopping_item WHERE checked')
  }

  /**
   * Replace the meal-plan half of the list with a freshly merged one.
   *
   * Manual items are never touched. Items already ticked off keep their tick
   * if the same line comes back, so regenerating mid-shop does not lose
   * track of what is already in the trolley.
   */
  public async replaceFromMealPlan(items: NewShoppingItem[]): Promise<ShoppingItem[]> {
    return PostgresDatabase.transaction(async client => {
      const previous = await client.query<{ name: string; quantity: string | null }>(
        "SELECT name, quantity FROM shopping_item WHERE origin = 'meal_plan' AND checked"
      )

      const alreadyBought = new Set(previous.rows.map(row => `${row.name.toLowerCase()}|${row.quantity ?? ''}`))

      await client.query("DELETE FROM shopping_item WHERE origin = 'meal_plan'")

      const created: ShoppingItemRow[] = []
      for (const item of items) {
        const wasChecked = alreadyBought.has(`${item.name.toLowerCase()}|${item.quantity ?? ''}`)

        const result = await client.query<ShoppingItemRow>(
          `INSERT INTO shopping_item (name, quantity, category, origin, recipe_id, checked)
           VALUES ($1, $2, $3, 'meal_plan', $4, $5)
           RETURNING ${COLUMNS}`,
          [item.name, item.quantity ?? null, item.category ?? null, item.recipeId ?? null, wasChecked]
        )

        if (result.rows[0]) created.push(result.rows[0])
      }

      return created.map(ShoppingItemRepository.toDomain)
    })
  }

  public async counts(): Promise<{ total: number; remaining: number }> {
    const row = await PostgresDatabase.one<{ total: string; remaining: string }>(
      'SELECT count(*)::text AS total, count(*) FILTER (WHERE NOT checked)::text AS remaining FROM shopping_item'
    )
    return { total: Number(row?.total ?? 0), remaining: Number(row?.remaining ?? 0) }
  }

  private static toDomain(row: ShoppingItemRow): ShoppingItem {
    return {
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      category: row.category,
      checked: row.checked,
      origin: row.origin,
      recipeId: row.recipe_id,
      createdAt: toIsoRequired(row.created_at),
      updatedAt: toIsoRequired(row.updated_at)
    }
  }
}
