import { AppProperties } from '../core/AppProperties'
import { CityArtService } from '../services/CityArtService'
import type { Task } from '../core/model/Task'

const service = new CityArtService()

/**
 * Draws one new map artwork per run.
 *
 * One at a time rather than filling the pool in a burst: each picture costs a
 * few megabytes of vector tiles from a service that charges nothing for them,
 * and there is no hurry — the screensaver has whatever was drawn before, and
 * the pool fills itself over the first day.
 *
 * Does nothing at all while the screensaver is set to photographs, so an
 * install that never turns this on never makes a single outbound request.
 */
export const cityArtRefreshTask: Task = {
  name: 'city-art-refresh',
  get cron() {
    return AppProperties.getString('tasks.cityart.refresh.cron', '17 */3 * * *')
  },
  enabled: true,
  runOnStartup: true,
  async execute() {
    const outcome = await service.generate()

    if (outcome.created) {
      const { cityName, country, themeName } = outcome.created
      console.info(
        `Drew ${cityName}${country ? `, ${country}` : ''} in ${themeName}` +
          (outcome.pruned > 0 ? ` (pruned ${outcome.pruned})` : '')
      )
      return
    }

    // Not an error: the feature may simply be switched off, or the few places
    // tried this time had too little mapped to be worth showing.
    if (outcome.reason) console.info(`No map artwork drawn: ${outcome.reason}`)
  }
}
