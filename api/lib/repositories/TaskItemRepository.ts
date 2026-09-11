import { PostgresDatabase } from '../db/PostgresDatabase'
import type { TaskItem, TaskPriority } from '../types/domain'
import { buildUpdate, toIso, toIsoRequired } from './rows'

interface TaskRow {
  id: string
  title: string
  notes: string | null
  assignee: string | null
  category: string | null
  priority: number
  due_at: Date | null
  completed_at: Date | null
  recurrence: string | null
  created_at: Date
  updated_at: Date
}

export interface NewTaskItem {
  title: string
  notes?: string | null
  assignee?: string | null
  category?: string | null
  priority?: TaskPriority
  dueAt?: Date | null
  recurrence?: string | null
}

export interface TaskItemUpdate {
  title?: string
  notes?: string | null
  assignee?: string | null
  category?: string | null
  priority?: TaskPriority
  dueAt?: Date | null
  recurrence?: string | null
}

export interface TaskItemFilter {
  includeCompleted?: boolean
  assignee?: string
  category?: string
  /** Only open tasks due at or before this instant, plus anything overdue. */
  dueBefore?: Date
  search?: string
  limit?: number
}

const COLUMNS =
  'id, title, notes, assignee, category, priority, due_at, completed_at, recurrence, created_at, updated_at'

export class TaskItemRepository {
  /**
   * Tasks matching a filter.
   *
   * Ordering puts open work first, then soonest due, with undated tasks
   * after dated ones rather than sorting as "never due", which would bury
   * them. Completed tasks come last, most recent first.
   */
  public async list(filter: TaskItemFilter = {}): Promise<TaskItem[]> {
    const conditions: string[] = []
    const params: unknown[] = []

    if (!filter.includeCompleted) conditions.push('completed_at IS NULL')

    if (filter.assignee !== undefined) {
      params.push(filter.assignee)
      conditions.push(`assignee IS NOT DISTINCT FROM $${params.length}`)
    }

    if (filter.category !== undefined) {
      params.push(filter.category)
      conditions.push(`category IS NOT DISTINCT FROM $${params.length}`)
    }

    if (filter.dueBefore !== undefined) {
      params.push(filter.dueBefore)
      conditions.push(`due_at IS NOT NULL AND due_at < $${params.length}`)
    }

    if (filter.search !== undefined && filter.search.trim().length > 0) {
      params.push(`%${filter.search.trim()}%`)
      conditions.push(`(title ILIKE $${params.length} OR notes ILIKE $${params.length})`)
    }

    let limitClause = ''
    if (filter.limit !== undefined) {
      params.push(Math.min(Math.max(filter.limit, 1), 500))
      limitClause = `LIMIT $${params.length}`
    }

    const rows = await PostgresDatabase.many<TaskRow>(
      `SELECT ${COLUMNS} FROM task
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY completed_at IS NOT NULL,
                completed_at DESC NULLS LAST,
                due_at ASC NULLS LAST,
                priority DESC,
                created_at
       ${limitClause}`,
      params
    )

    return rows.map(TaskItemRepository.toDomain)
  }

  public async byId(id: string): Promise<TaskItem | null> {
    const row = await PostgresDatabase.one<TaskRow>(`SELECT ${COLUMNS} FROM task WHERE id = $1`, [id])
    return row ? TaskItemRepository.toDomain(row) : null
  }

  public async create(task: NewTaskItem): Promise<TaskItem> {
    const row = await PostgresDatabase.one<TaskRow>(
      `INSERT INTO task (title, notes, assignee, category, priority, due_at, recurrence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        task.title,
        task.notes ?? null,
        task.assignee ?? null,
        task.category ?? null,
        task.priority ?? 0,
        task.dueAt ?? null,
        task.recurrence ?? null
      ]
    )
    return TaskItemRepository.toDomain(row as TaskRow)
  }

  public async update(id: string, changes: TaskItemUpdate): Promise<TaskItem | null> {
    const { clause, params } = buildUpdate(
      {
        title: changes.title,
        notes: changes.notes,
        assignee: changes.assignee,
        category: changes.category,
        priority: changes.priority,
        due_at: changes.dueAt,
        recurrence: changes.recurrence
      },
      1
    )

    if (clause.length === 0) return this.byId(id)

    const row = await PostgresDatabase.one<TaskRow>(
      `UPDATE task SET ${clause} WHERE id = $${params.length + 1} RETURNING ${COLUMNS}`,
      [...params, id]
    )
    return row ? TaskItemRepository.toDomain(row) : null
  }

  public async setCompleted(id: string, completed: boolean): Promise<TaskItem | null> {
    const row = await PostgresDatabase.one<TaskRow>(
      `UPDATE task SET completed_at = ${completed ? 'now()' : 'NULL'} WHERE id = $1 RETURNING ${COLUMNS}`,
      [id]
    )
    return row ? TaskItemRepository.toDomain(row) : null
  }

  /**
   * Complete a task and, if it recurs, create its next occurrence.
   */
  public async completeWithFollowUp(
    id: string,
    nextDueAt: Date | null
  ): Promise<{ completed: TaskItem; next: TaskItem | null }> {
    return PostgresDatabase.transaction(async client => {
      const completedResult = await client.query<TaskRow>(
        `UPDATE task SET completed_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
        [id]
      )
      const completedRow = completedResult.rows[0]
      if (!completedRow) throw new Error(`No task with id '${id}'`)

      if (nextDueAt === null) {
        return { completed: TaskItemRepository.toDomain(completedRow), next: null }
      }

      const nextResult = await client.query<TaskRow>(
        `INSERT INTO task (title, notes, assignee, category, priority, due_at, recurrence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${COLUMNS}`,
        [
          completedRow.title,
          completedRow.notes,
          completedRow.assignee,
          completedRow.category,
          completedRow.priority,
          nextDueAt,
          completedRow.recurrence
        ]
      )

      const nextRow = nextResult.rows[0]
      return {
        completed: TaskItemRepository.toDomain(completedRow),
        next: nextRow ? TaskItemRepository.toDomain(nextRow) : null
      }
    })
  }

  public async remove(id: string): Promise<boolean> {
    return (await PostgresDatabase.execute('DELETE FROM task WHERE id = $1', [id])) > 0
  }

  /** Counts for the dashboard widget's badge. */
  public async summary(dueBefore: Date): Promise<{ open: number; dueSoon: number; overdue: number }> {
    const row = await PostgresDatabase.one<{ open: string; due_soon: string; overdue: string }>(
      `SELECT count(*)::text AS open,
              count(*) FILTER (WHERE due_at IS NOT NULL AND due_at < $1)::text AS due_soon,
              count(*) FILTER (WHERE due_at IS NOT NULL AND due_at < now())::text AS overdue
       FROM task
       WHERE completed_at IS NULL`,
      [dueBefore]
    )

    return {
      open: Number(row?.open ?? 0),
      dueSoon: Number(row?.due_soon ?? 0),
      overdue: Number(row?.overdue ?? 0)
    }
  }

  /**
   * Open tasks for a set of people, for the per-person strip.
   *
   * One query for the whole household rather than one per person: the strip
   * is on the dashboard, which loads on every wake, and five round trips to
   * Postgres for five columns is five times the work for no benefit.
   *
   * Matching is case-insensitive and ignores surrounding spaces, because an
   * assignee is free text somebody typed on a touchscreen and "skye " should
   * not quietly become a sixth person.
   */
  public async openForAssignees(names: readonly string[]): Promise<TaskItem[]> {
    if (names.length === 0) return []

    const rows = await PostgresDatabase.many<TaskRow>(
      `SELECT ${COLUMNS} FROM task
        WHERE completed_at IS NULL
          AND lower(btrim(assignee)) = ANY($1::text[])
        ORDER BY due_at ASC NULLS LAST, priority DESC, created_at`,
      [names.map(name => name.trim().toLowerCase())]
    )

    return rows.map(TaskItemRepository.toDomain)
  }

  /**
   * How many tasks each person has finished since an instant.
   *
   * Counted in SQL rather than by fetching completed rows, because a
   * household that has been running for a year has a great many of them and
   * the strip only ever shows the number.
   */
  public async completedCountsSince(names: readonly string[], since: Date): Promise<Map<string, number>> {
    if (names.length === 0) return new Map()

    const rows = await PostgresDatabase.many<{ assignee: string; total: string }>(
      `SELECT lower(btrim(assignee)) AS assignee, count(*)::text AS total
         FROM task
        WHERE completed_at IS NOT NULL
          AND completed_at >= $2
          AND lower(btrim(assignee)) = ANY($1::text[])
        GROUP BY 1`,
      [names.map(name => name.trim().toLowerCase()), since]
    )

    return new Map(rows.map(row => [row.assignee, Number(row.total)]))
  }

  /** Existing assignees and categories, to offer as suggestions in the UI. */
  public async distinctValues(): Promise<{ assignees: string[]; categories: string[] }> {
    const [assignees, categories] = await Promise.all([
      PostgresDatabase.many<{ value: string }>(
        "SELECT DISTINCT assignee AS value FROM task WHERE assignee IS NOT NULL AND assignee <> '' ORDER BY value"
      ),
      PostgresDatabase.many<{ value: string }>(
        "SELECT DISTINCT category AS value FROM task WHERE category IS NOT NULL AND category <> '' ORDER BY value"
      )
    ])

    return {
      assignees: assignees.map(row => row.value),
      categories: categories.map(row => row.value)
    }
  }

  private static toDomain(row: TaskRow): TaskItem {
    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      assignee: row.assignee,
      category: row.category,
      priority: row.priority as TaskPriority,
      dueAt: toIso(row.due_at),
      completedAt: toIso(row.completed_at),
      recurrence: row.recurrence,
      createdAt: toIsoRequired(row.created_at),
      updatedAt: toIsoRequired(row.updated_at)
    }
  }
}
