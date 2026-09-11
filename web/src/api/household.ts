import { api } from './client'
import type { BinOutlook, PersonDay } from './types'

export const householdApi = {
  /** Everybody's day, one entry per name in the household roster. */
  peopleToday: () => api.get<PersonDay[]>('/household/people/today'),

  /** The next waste collection, and the one after it. */
  bins: () => api.get<BinOutlook>('/household/bins')
}
