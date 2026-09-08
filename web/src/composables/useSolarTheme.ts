import { onScopeDispose, watch } from 'vue'
import { weatherApi } from '@/api/weather'
import { useSettingsStore } from '@/stores/settings'
import { sunTimesFrom } from '@/utils/theme'

/**
 * Keeps the automatic theme supplied with today's sunrise and sunset.
 *
 * Called once from the app shell. The times come from the weather report,
 * which is a cached database read on the API side — so this costs nothing
 * upstream, and it is only fetched at all while the theme is set to auto.
 *
 * Refetched every few hours rather than daily, because "today" changes at
 * midnight and this display is left running for weeks: a Pi that has been on
 * since Tuesday should not still be working from Tuesday's sunset.
 */
const REFRESH_MS = 3 * 60 * 60 * 1000

export function useSolarTheme(): void {
  const settings = useSettingsStore()

  let timer: ReturnType<typeof setInterval> | null = null

  async function refresh(): Promise<void> {
    try {
      const report = await weatherApi.report()
      const today = report.daily[0]

      settings.setSunTimes(today ? sunTimesFrom(today.sunrise, today.sunset) : null)
    } catch {
      // No forecast to work from. The resolver falls back to fixed hours,
      // which is a great deal better than the theme sticking on whichever it
      // happened to be at the time.
      settings.setSunTimes(null)
    }
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  watch(
    () => settings.themePreference,
    preference => {
      if (preference !== 'auto') {
        stop()
        return
      }

      void refresh()
      if (timer === null) timer = setInterval(() => void refresh(), REFRESH_MS)
    },
    { immediate: true }
  )

  onScopeDispose(stop)
}
