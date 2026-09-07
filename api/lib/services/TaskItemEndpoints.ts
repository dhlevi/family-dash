import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { SettingRepository } from '../repositories/SettingRepository'
import { TaskItemRepository, type TaskItemFilter } from '../repositories/TaskItemRepository'
import { nextOccurrence, RECURRENCES } from './Recurrence'
import type { TaskItem, TaskPriority } from '../types/domain'

const tasks = new TaskItemRepository()
const settings = new SettingRepository()

const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

const newTaskSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(200),
  notes: z.string().trim().max(4000).nullish(),
  assignee: z.string().trim().max(40).nullish(),
  category: z.string().trim().max(40).nullish(),
  priority: prioritySchema.optional(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  recurrence: z.enum(RECURRENCES).nullish()
})

const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(4000).nullish(),
  assignee: z.string().trim().max(40).nullish(),
  category: z.string().trim().max(40).nullish(),
  priority: prioritySchema.optional(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  recurrence: z.enum(RECURRENCES).nullish()
})

export interface TaskCompletion {
  completed: TaskItem
  /** The next occurrence, when the task recurs. */
  next: TaskItem | null
}

export interface TaskSummary {
  open: number
  dueSoon: number
  overdue: number
}

export class TaskItemEndpoints {
  public async list(
    includeCompleted?: boolean,
    assignee?: string,
    category?: string,
    dueBefore?: string,
    search?: string,
    limit?: number
  ): Promise<TaskItem[]> {
    const filter: TaskItemFilter = {
      includeCompleted: includeCompleted ?? (await this.showCompletedByDefault()),
      assignee,
      category,
      search,
      limit
    }

    if (dueBefore !== undefined) {
      const parsed = new Date(dueBefore)
      if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest(`'dueBefore' is not a valid date: ${dueBefore}`)
      filter.dueBefore = parsed
    }

    return tasks.list(filter)
  }

  public async byId(id: string): Promise<TaskItem> {
    const task = await tasks.byId(id)
    if (!task) throw ApiError.notFound(`No task with id '${id}'`)
    return task
  }

  public async create(body: unknown): Promise<TaskItem> {
    const parsed = newTaskSchema.parse(body)

    // A recurring task with no due date has nothing to recur from, and would
    // silently behave as a one-off. Say so instead.
    if (parsed.recurrence && !parsed.dueAt) {
      throw ApiError.unprocessable('A repeating task needs a due date to repeat from', { field: 'dueAt' })
    }

    return tasks.create({
      title: parsed.title,
      notes: parsed.notes ?? null,
      assignee: TaskItemEndpoints.blankToNull(parsed.assignee),
      category: TaskItemEndpoints.blankToNull(parsed.category),
      priority: parsed.priority as TaskPriority | undefined,
      dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
      recurrence: parsed.recurrence ?? null
    })
  }

  public async update(id: string, body: unknown): Promise<TaskItem> {
    const parsed = taskUpdateSchema.parse(body)
    const existing = await tasks.byId(id)
    if (!existing) throw ApiError.notFound(`No task with id '${id}'`)

    const recurrence = parsed.recurrence === undefined ? existing.recurrence : parsed.recurrence
    const dueAt = parsed.dueAt === undefined ? existing.dueAt : parsed.dueAt

    if (recurrence && !dueAt) {
      throw ApiError.unprocessable('A repeating task needs a due date to repeat from', { field: 'dueAt' })
    }

    const updated = await tasks.update(id, {
      title: parsed.title,
      notes: parsed.notes,
      assignee: parsed.assignee === undefined ? undefined : TaskItemEndpoints.blankToNull(parsed.assignee),
      category: parsed.category === undefined ? undefined : TaskItemEndpoints.blankToNull(parsed.category),
      priority: parsed.priority as TaskPriority | undefined,
      dueAt: parsed.dueAt === undefined ? undefined : parsed.dueAt === null ? null : new Date(parsed.dueAt),
      recurrence: parsed.recurrence
    })

    if (!updated) throw ApiError.notFound(`No task with id '${id}'`)
    return updated
  }

  /**
   * Tick a task off.
   *
   * A recurring task is completed *and* its next occurrence created, in one
   * transaction — the chore stays on the list rather than needing to be
   * re-entered every week.
   */
  public async complete(id: string): Promise<TaskCompletion> {
    const existing = await tasks.byId(id)
    if (!existing) throw ApiError.notFound(`No task with id '${id}'`)

    if (existing.completedAt !== null) {
      // Idempotent: a double tap on a touchscreen should not create a second
      // occurrence of a chore.
      return { completed: existing, next: null }
    }

    const nextDueAt = existing.dueAt ? nextOccurrence(existing.recurrence, new Date(existing.dueAt)) : null

    if (nextDueAt === null) {
      const completed = await tasks.setCompleted(id, true)
      if (!completed) throw ApiError.notFound(`No task with id '${id}'`)
      return { completed, next: null }
    }

    return tasks.completeWithFollowUp(id, nextDueAt)
  }

  /** Un-tick a task. Does not remove any occurrence created on completion. */
  public async reopen(id: string): Promise<TaskItem> {
    const reopened = await tasks.setCompleted(id, false)
    if (!reopened) throw ApiError.notFound(`No task with id '${id}'`)
    return reopened
  }

  public async remove(id: string): Promise<void> {
    if (!(await tasks.remove(id))) throw ApiError.notFound(`No task with id '${id}'`)
  }

  /** Counts for the dashboard widget. */
  public async summary(dueBefore?: string): Promise<TaskSummary> {
    const boundary = dueBefore ? new Date(dueBefore) : TaskItemEndpoints.endOfToday()
    if (Number.isNaN(boundary.getTime())) {
      throw ApiError.badRequest(`'dueBefore' is not a valid date: ${dueBefore}`)
    }

    return tasks.summary(boundary)
  }

  /** Assignees and categories already in use, plus any configured in Settings. */
  public async suggestions(): Promise<{ assignees: string[]; categories: string[] }> {
    const [used, configured] = await Promise.all([tasks.distinctValues(), settings.get('tasks.assignees')])

    const fromSettings = Array.isArray(configured) ? configured.filter((v): v is string => typeof v === 'string') : []

    return {
      assignees: [...new Set([...fromSettings, ...used.assignees])].sort((a, b) => a.localeCompare(b)),
      categories: used.categories
    }
  }

  private async showCompletedByDefault(): Promise<boolean> {
    return (await settings.get('tasks.showCompleted')) === true
  }

  /**
   * End of the current day in the container's timezone, which is the
   * household's — the dashboard's "due today" needs to mean the day the
   * people looking at the screen are having.
   */
  private static endOfToday(): Date {
    const boundary = new Date()
    boundary.setHours(23, 59, 59, 999)
    return boundary
  }

  /** An emptied text field arrives as '' and should clear the column. */
  private static blankToNull(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null
    return value.trim().length === 0 ? null : value.trim()
  }
}
