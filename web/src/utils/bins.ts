import { formatRelativeDay } from './datetime'
import type { BinCollectionView, BinKind } from '@/api/types'

/**
 * Presentation for the bin day widget.
 *
 * The kind colours follow the bins themselves wherever the two agree, which
 * is most of the time and in most places: blue is recycling, green is food,
 * brown is garden, etc.
 */
export const BIN_LABELS: Record<BinKind, string> = {
  garbage: 'Garbage',
  recycling: 'Recycling',
  organics: 'Food scraps',
  yard: 'Yard waste',
  glass: 'Glass'
}

export const BIN_COLOURS: Record<BinKind, string> = {
  garbage: '#6b7280',
  recycling: '#3f8fd6',
  organics: '#4fa46b',
  yard: '#a3762f',
  glass: '#35a3a0'
}

/**
 * A local date string as a Date, at midday.
 *
 * Midday rather than midnight because `new Date('2026-09-17')` is parsed as
 * UTC while `new Date('2026-09-17T12:00:00')` is parsed as local
 */
export function parseCollectionDate(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

/**
 * What to call the next collection.
 *
 * "Tonight" is the only one of these that asks for something to be done, so
 * it is phrased as an instruction and everything else is phrased as a fact.
 */
export function urgencyLabel(collection: BinCollectionView): string {
  switch (collection.urgency) {
    case 'tonight':
      return 'Put them out tonight'
    case 'today':
      return 'Today'
    case 'tomorrow':
      return 'Tomorrow'
    default:
      return formatRelativeDay(parseCollectionDate(collection.date))
  }
}

/** Whether this one deserves the loud treatment. */
export function isUrgent(collection: BinCollectionView): boolean {
  return collection.urgency === 'tonight' || collection.urgency === 'today'
}
