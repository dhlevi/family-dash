import { api } from './client'
import type { NewTaskItem, TaskCompletion, TaskItem, TaskSuggestions, TaskSummary } from './types'

export interface TaskFilter {
  includeCompleted?: boolean
  assignee?: string
  category?: string
  /** ISO instant; returns open tasks due before it, including overdue ones. */
  dueBefore?: string
  search?: string
  limit?: number
}

export const tasksApi = {
  list: (filter: TaskFilter = {}) => api.get<TaskItem[]>('/tasks', { query: { ...filter } }),

  /** Counts for the dashboard badge. */
  summary: (dueBefore?: string) => api.get<TaskSummary>('/tasks/summary', { query: { dueBefore } }),

  suggestions: () => api.get<TaskSuggestions>('/tasks/suggestions'),

  get: (id: string) => api.get<TaskItem>(`/tasks/${id}`),

  add: (task: NewTaskItem) => api.post<TaskItem>('/tasks', task),

  update: (id: string, changes: Partial<NewTaskItem>) => api.patch<TaskItem>(`/tasks/${id}`, changes),

  /** Ticks a task off; a repeating task also gets its next occurrence back. */
  complete: (id: string) => api.post<TaskCompletion>(`/tasks/${id}/complete`),

  reopen: (id: string) => api.post<TaskItem>(`/tasks/${id}/reopen`),

  remove: (id: string) => api.delete<void>(`/tasks/${id}`)
}
