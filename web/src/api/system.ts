import { api } from './client'
import type { HealthReport, SystemInfo, TaskStatus } from './types'

export const systemApi = {
  ping: () => api.get<{ pong: true; timestamp: string }>('/system/ping', { timeoutMs: 5000 }),
  info: () => api.get<SystemInfo>('/system/info'),
  tasks: () => api.get<TaskStatus[]>('/system/tasks'),
  runTask: (name: string) =>
    api.post<TaskStatus>(`/system/tasks/${encodeURIComponent(name)}/run`, undefined, {
      // A manual refresh triggers a real fetch of a feed, which can be slow.
      timeoutMs: 60000
    }),
  health: () => api.health<HealthReport>()
}
