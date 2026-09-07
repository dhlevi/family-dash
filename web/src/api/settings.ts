import { api } from './client'
import type { AppSettings, SettingCatalogEntry, SettingKey } from './types'

export const settingsApi = {
  /** Every setting: stored values layered over the API's defaults. */
  all: () => api.get<AppSettings>('/settings'),

  catalog: () => api.get<SettingCatalogEntry[]>('/settings/catalog'),

  /** Set one value. The API accepts a bare scalar body. */
  set: <K extends SettingKey>(key: K, value: AppSettings[K]) =>
    api.put<{ key: K; value: AppSettings[K] }>(`/settings/${encodeURIComponent(key)}`, value),

  /** Save a group of settings together; rejected as a batch if any is invalid. */
  update: (changes: Partial<AppSettings>) => api.patch<AppSettings>('/settings', changes),

  reset: (key: SettingKey) => api.delete<{ key: string; value: unknown }>(`/settings/${encodeURIComponent(key)}`)
}
