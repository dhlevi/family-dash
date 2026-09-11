import { api } from './client'
import type { NotificationStatus, SweepOutcome } from './types'

export const notificationsApi = {
  status: () => api.get<NotificationStatus>('/notifications'),

  /** Generates any topic that does not exist yet. Safe to call repeatedly. */
  setup: () => api.post<NotificationStatus>('/notifications/setup'),

  /** Sends one message, so somebody can check their phone is subscribed. */
  test: (topic: string) => api.post<void>('/notifications/test', { topic }),

  /** Runs a sweep now rather than waiting for the schedule. */
  sweep: () => api.post<SweepOutcome>('/notifications/sweep', undefined, { timeoutMs: 60000 })
}
