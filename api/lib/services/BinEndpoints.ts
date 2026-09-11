import { EventRepository } from '../repositories/EventRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { groupByDay, localDay, urgencyFor, type BinCollection } from './bins'
import type { BinCollectionView, BinOutlook } from '../types/domain'

const settings = new SettingRepository()
const events = new EventRepository()

/**
 * When the bins go out.
 *
 * Reads the calendar cache that the ordinary sync already fills, so a council
 * collection feed is subscribed to exactly like a school calendar and there is
 * no second kind of sync to keep working. What this adds is prominence: a
 * collection buried among twenty other events in a month grid is information
 * nobody sees in time to act on.
 */
export class BinEndpoints {
  /** How far ahead to look. Long enough to survive a fortnightly rhythm. */
  private static readonly HORIZON_DAYS = 28

  public async outlook(now = new Date()): Promise<BinOutlook> {
    const stored = await settings.all()

    const sourceIds = Array.isArray(stored['bins.sourceIds']) ? (stored['bins.sourceIds'] as string[]) : []
    const eveningHour = typeof stored['bins.eveningHour'] === 'number' ? (stored['bins.eveningHour'] as number) : 16

    // From the start of today, not from now: a collection this morning is
    // still worth showing this afternoon, because the bins may still be out.
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + BinEndpoints.HORIZON_DAYS)

    // An empty selection means "look everywhere and let the titles decide",
    // which is what makes this work before anybody has configured anything.
    const found = await events.inRange({ from, to }, sourceIds.length > 0 ? sourceIds : undefined)

    const days = groupByDay(found.map(event => ({ title: event.title, startsAt: new Date(event.startsAt) })))

    const view = (collection: BinCollection | undefined): BinCollectionView | null =>
      collection
        ? {
            date: collection.date,
            kinds: collection.kinds,
            titles: collection.titles,
            urgency: urgencyFor(collection, now, eveningHour),
            inDays: BinEndpoints.daysBetween(localDay(now), collection.date)
          }
        : null

    return { next: view(days[0]), following: view(days[1]), sourcesChosen: sourceIds.length > 0 }
  }

  /**
   * Whole days between two local dates.
   *
   * Compared at midday so that a clock change inside the window cannot round
   * a 24-hour gap down to 23 and turn tomorrow into today.
   */
  private static daysBetween(from: string, to: string): number {
    const start = new Date(`${from}T12:00:00`).getTime()
    const end = new Date(`${to}T12:00:00`).getTime()

    return Math.round((end - start) / 86_400_000)
  }
}
