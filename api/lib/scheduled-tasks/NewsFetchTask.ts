import { AppProperties } from '../core/AppProperties'
import { NewsService } from '../services/NewsService'
import type { Task } from '../core/model/Task'

const service = new NewsService()

/**
 * Keeps the headline cache current and prunes what has aged out.
 *
 * Runs on startup as well as on its schedule, so a Pi switched on in the
 * morning shows today's news rather than yesterday's until the next
 * interval.
 *
 * A feed that fails is recorded against that feed and does not fail the
 * task; the task only fails if *every* feed did, which is the signal that
 * something broader is wrong.
 */
export const newsFetchTask: Task = {
  name: 'news-fetch',
  get cron() {
    return AppProperties.getString('tasks.news.fetch.cron', '*/30 * * * *')
  },
  enabled: true,
  runOnStartup: true,
  async execute() {
    const outcomes = await service.fetchAll()
    if (outcomes.length === 0) return

    const failed = outcomes.filter(outcome => outcome.error !== null)

    if (failed.length === outcomes.length) {
      throw new Error(`Every news feed failed to fetch. First error: ${failed[0]?.error ?? 'unknown'}`)
    }
  }
}
