import { AppProperties } from '../core/AppProperties'
import { WeatherService } from '../services/WeatherService'
import type { Task } from '../core/model/Task'

const service = new WeatherService()

/**
 * Keeps the cached forecast current.
 *
 * Runs on startup as well as on its schedule, so a Pi that has been switched
 * off overnight shows today's weather as soon as it boots rather than at the
 * top of the next interval.
 */
export const weatherRefreshTask: Task = {
  name: 'weather-refresh',
  get cron() {
    return AppProperties.getString('tasks.weather.refresh.cron', '*/20 * * * *')
  },
  enabled: true,
  runOnStartup: true,
  async execute() {
    // A throw here is recorded against the task and surfaced in Settings;
    // it does not stop the schedule. See WeatherService.refresh.
    const outcome = await service.refresh()
    console.info(`Weather refreshed from ${outcome.provider} for ${outcome.location}`)
  }
}
