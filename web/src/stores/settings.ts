import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { settingsApi } from '@/api/settings'
import { resolveAutoTheme, type SunTimes } from '@/utils/theme'
import type { AppSettings, ScreensaverSource, SettingKey, Theme, ThemePreference } from '@/api/types'

/**
 * Application preferences, loaded once and shared.
 *
 * The API always answers with a complete set (stored values over defaults),
 * so this store never has to reason about a missing key. Appearance settings
 * are applied to the document as a side effect, which is what makes the
 * theme switch instant rather than needing a reload.
 */
export const useSettingsStore = defineStore('settings', () => {
  const values = ref<AppSettings | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const loaded = computed(() => values.value !== null)

  /**
   * Typed read with a fallback for the window before the first load
   * resolves. Components can render immediately instead of gating on it.
   */
  function get<K extends SettingKey>(key: K, fallback: AppSettings[K]): AppSettings[K] {
    const value = values.value?.[key]
    return value === undefined ? fallback : value
  }

  /** What the setting says, which may be 'auto'. */
  const themePreference = computed<ThemePreference>(() => get('appearance.theme', 'dark'))
  const autoThemeOffsetMinutes = computed(() => get('appearance.autoThemeOffsetMinutes', 30))

  /**
   * Today's sunrise and sunset, when something has supplied them.
   *
   * Fed in from outside rather than fetched here: they come from the weather
   * report, and a preferences store has no business knowing about the
   * weather. `useSolarTheme` is what keeps this current, and only while the
   * theme is actually set to auto.
   */
  const sunTimes = ref<SunTimes | null>(null)

  function setSunTimes(times: SunTimes | null): void {
    sunTimes.value = times
  }

  /**
   * A coarse ticker, so the automatic theme changes over without a reload.
   *
   * One minute is plenty for a boundary that moves by a minute or two a day,
   * and it keeps this off the one-second clock the header runs on. Only
   * ticking while the theme is automatic, since nothing else here depends on
   * the time.
   */
  const minute = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | null = null

  watch(
    themePreference,
    preference => {
      if (preference === 'auto' && ticker === null) {
        ticker = setInterval(() => (minute.value = Date.now()), 60_000)
      } else if (preference !== 'auto' && ticker !== null) {
        clearInterval(ticker)
        ticker = null
      }
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    if (ticker !== null) clearInterval(ticker)
    ticker = null
  })

  /** The theme actually applied to the document. Never 'auto'. */
  const theme = computed<Theme>(() =>
    themePreference.value === 'auto'
      ? resolveAutoTheme(new Date(minute.value), sunTimes.value, autoThemeOffsetMinutes.value)
      : themePreference.value
  )

  const accent = computed(() => get('appearance.accent', '#4f8ef7'))
  const onScreenKeyboard = computed(() => get('input.onScreenKeyboard', 'auto'))
  const clock24Hour = computed(() => get('appearance.clock24Hour', true))
  const weekStartsOn = computed(() => get('calendar.weekStartsOn', 0))
  const dashboardWidgets = computed(() => get('dashboard.widgets', []))
  const showCompletedTasks = computed(() => get('tasks.showCompleted', false))
  const slideshowSeconds = computed(() => get('photos.slideshowSeconds', 20))
  const screensaverMinutes = computed(() => get('appearance.screensaverMinutes', 0))
  const screensaverSource = computed<ScreensaverSource>(() => get('appearance.screensaverSource', 'gallery'))

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      values.value = await settingsApi.all()
    } catch (caught) {
      error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load settings'
    } finally {
      loading.value = false
    }
  }

  /**
   * Save a group of changes.
   *
   * The response is the full settings map, so local state cannot drift from
   * what the API actually stored including any value it coerced.
   */
  async function save(changes: Partial<AppSettings>): Promise<boolean> {
    saving.value = true
    error.value = null

    try {
      values.value = await settingsApi.update(changes)
      return true
    } catch (caught) {
      error.value = caught instanceof ApiRequestError ? describe(caught) : 'Could not save settings'
      return false
    } finally {
      saving.value = false
    }
  }

  /** Save a single setting. */
  async function set<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<boolean> {
    return save({ [key]: value } as Partial<AppSettings>)
  }

  async function reset(key: SettingKey): Promise<void> {
    await settingsApi.reset(key)
    await load()
  }

  /**
   * Applies appearance settings to the document.
   *
   * The stylesheet defines its palette against `:root` and
   * `:root[data-theme='light']`, and reads the accent from a single custom
   * property, so this is all the theme switch has to do.
   */
  function applyAppearance(): void {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    root.dataset.theme = theme.value
    root.style.setProperty('--fd-accent', accent.value)
    // Keep the derived soft tint in step with the accent.
    root.style.setProperty('--fd-accent-soft', `color-mix(in srgb, ${accent.value} 16%, transparent)`)
  }

  watch([theme, accent], applyAppearance, { immediate: true })

  /** Turns a validation failure into something worth showing a person. */
  function describe(caught: ApiRequestError): string {
    const details = caught.details
    if (details && typeof details === 'object') {
      const messages = Object.entries(details as Record<string, unknown>).map(
        ([key, issues]) => `${key}: ${Array.isArray(issues) ? issues.join(', ') : String(issues)}`
      )
      if (messages.length > 0) return messages.join('; ')
    }
    return caught.message
  }

  return {
    values,
    loading,
    saving,
    error,
    loaded,
    get,
    theme,
    themePreference,
    autoThemeOffsetMinutes,
    sunTimes,
    setSunTimes,
    accent,
    onScreenKeyboard,
    clock24Hour,
    weekStartsOn,
    dashboardWidgets,
    showCompletedTasks,
    slideshowSeconds,
    screensaverMinutes,
    screensaverSource,
    load,
    save,
    set,
    reset,
    applyAppearance
  }
})
