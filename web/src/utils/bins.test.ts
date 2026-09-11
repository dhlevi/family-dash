import { describe, expect, it, vi, afterEach } from 'vitest'
import { BIN_COLOURS, BIN_LABELS, isUrgent, parseCollectionDate, urgencyLabel } from './bins'
import type { BinCollectionView, BinKind } from '@/api/types'

const KINDS: BinKind[] = ['garbage', 'recycling', 'organics', 'yard', 'glass']

function collection(overrides: Partial<BinCollectionView> = {}): BinCollectionView {
  return { date: '2026-09-17', kinds: ['garbage'], titles: ['Garbage'], urgency: 'upcoming', inDays: 4, ...overrides }
}

afterEach(() => vi.useRealTimers())

describe('labels and colours', () => {
  it('names and colours every kind the API can send', () => {
    for (const kind of KINDS) {
      expect(BIN_LABELS[kind]).toBeTruthy()
      expect(BIN_COLOURS[kind]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('gives each kind its own colour, so they can be told apart', () => {
    expect(new Set(Object.values(BIN_COLOURS)).size).toBe(KINDS.length)
  })
})

describe('parseCollectionDate', () => {
  it('reads the date as local, not as UTC', () => {
    // `new Date('2026-09-17')` is UTC midnight, which is the 16th anywhere
    // west of Greenwich — and would put bin day on the wrong evening.
    const parsed = parseCollectionDate('2026-09-17')

    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(17)
  })
})

describe('urgencyLabel', () => {
  it('asks for the bins to go out, rather than stating a fact', () => {
    expect(urgencyLabel(collection({ urgency: 'tonight' }))).toBe('Put them out tonight')
  })

  it.each([
    ['today', 'Today'],
    ['tomorrow', 'Tomorrow']
  ] as const)('states %s plainly', (urgency, expected) => {
    expect(urgencyLabel(collection({ urgency }))).toBe(expected)
  })

  it('names the weekday for something later this week', () => {
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0, 0))

    expect(urgencyLabel(collection({ date: '2026-09-17', urgency: 'upcoming' }))).toBe('Thursday')
  })
})

describe('isUrgent', () => {
  it('is loud only when there is something to do now', () => {
    expect(isUrgent(collection({ urgency: 'tonight' }))).toBe(true)
    expect(isUrgent(collection({ urgency: 'today' }))).toBe(true)
    expect(isUrgent(collection({ urgency: 'tomorrow' }))).toBe(false)
    expect(isUrgent(collection({ urgency: 'upcoming' }))).toBe(false)
  })
})
