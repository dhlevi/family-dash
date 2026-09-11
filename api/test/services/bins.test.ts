import { describe, expect, it } from 'vitest'
import { classify, groupByDay, localDay, urgencyFor, type BinCollection } from '../../lib/services/bins'

/**
 * The titles here are the shapes real authorities publish, on both sides of
 * the Atlantic, because that is where this either works or does not. The
 * interesting failures are not hypothetical: "Yard Waste" contains the word
 * waste, and a green bin means two different things depending on which
 * country you are standing in.
 */
describe('classify', () => {
  it.each([
    ['Garbage Collection', ['garbage']],
    ['Trash Day', ['garbage']],
    ['Refuse', ['garbage']],
    ['Rubbish collection', ['garbage']],
    ['General Waste', ['garbage']],
    ['Black Bin', ['garbage']],
    ['Recycling', ['recycling']],
    ['Blue Box', ['recycling']],
    ['Kerbside Recycling Collection', ['recycling']],
    ['Curbside Recycling Collection', ['recycling']],
    ['Mixed Containers', ['recycling']],
    ['Food Scraps', ['organics']],
    ['Organics', ['organics']],
    ['Green Bin', ['organics']],
    ['Food waste caddy', ['organics']],
    ['Yard Waste', ['yard']],
    ['Garden Waste Collection', ['yard']],
    ['Brown Bin', ['yard']],
    ['Glass', ['glass']]
  ])('reads %s', (title, expected) => {
    expect(classify(title)).toEqual(expected)
  })

  it('never reads a yard collection as landfill', () => {
    // The trap: "waste" on its own would match all three of these.
    expect(classify('Yard Waste')).not.toContain('garbage')
    expect(classify('Garden Waste')).not.toContain('garbage')
    expect(classify('Food Waste')).not.toContain('garbage')
  })

  it('returns every stream a combined title mentions', () => {
    expect(classify('Garbage & Organics')).toEqual(['garbage', 'organics'])
    // Saanich collects these together, which is why one event can be two jobs.
    expect(classify('Food Scraps and Yard Waste')).toEqual(['organics', 'yard'])
  })

  it('orders the kinds the same way however the title is written', () => {
    expect(classify('Organics and Garbage')).toEqual(classify('Garbage and Organics'))
  })

  it('says nothing about an event that is not a collection', () => {
    // Ordinary appointments share the calendar, and must not turn up as bins.
    expect(classify('Dentist')).toEqual([])
    expect(classify("Skye's birthday")).toEqual([])
    expect(classify('Council meeting')).toEqual([])
  })

  it('is not fooled by a word that merely contains a keyword', () => {
    expect(classify('Glassblowing class')).toEqual([])
    expect(classify('Papermaking workshop')).toEqual([])
  })
})

const at = (date: string, title: string) => ({ title, startsAt: new Date(`${date}T07:00:00`) })

describe('groupByDay', () => {
  it("merges a morning's separate events into one trip to the kerb", () => {
    const grouped = groupByDay([at('2026-09-17', 'Garbage'), at('2026-09-17', 'Food Scraps & Yard Waste')])

    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.kinds).toEqual(['garbage', 'organics', 'yard'])
    expect(grouped[0]?.titles).toEqual(['Garbage', 'Food Scraps & Yard Waste'])
  })

  it('keeps separate days separate, earliest first', () => {
    const grouped = groupByDay([at('2026-09-24', 'Recycling'), at('2026-09-17', 'Garbage')])

    expect(grouped.map(day => day.date)).toEqual(['2026-09-17', '2026-09-24'])
  })

  it('drops events that are not about bins', () => {
    expect(groupByDay([at('2026-09-17', 'Parent evening')])).toEqual([])
  })

  it('does not repeat a title that appears twice on one day', () => {
    const grouped = groupByDay([at('2026-09-17', 'Recycling'), at('2026-09-17', 'Recycling')])

    expect(grouped[0]?.titles).toEqual(['Recycling'])
  })

  it('has nothing to say about an empty calendar', () => {
    expect(groupByDay([])).toEqual([])
  })
})

describe('urgencyFor', () => {
  const collection = (date: string): BinCollection => ({ date, kinds: ['garbage'], titles: ['Garbage'] })

  it('asks for the bins to go out once the evening has come', () => {
    const sixPm = new Date('2026-09-16T18:00:00')

    expect(urgencyFor(collection('2026-09-17'), sixPm, 16)).toBe('tonight')
  })

  it('calls it tomorrow while it is still the middle of the day', () => {
    const tenAm = new Date('2026-09-16T10:00:00')

    expect(urgencyFor(collection('2026-09-17'), tenAm, 16)).toBe('tomorrow')
  })

  it('calls it today on the morning itself', () => {
    const sevenAm = new Date('2026-09-17T07:00:00')

    expect(urgencyFor(collection('2026-09-17'), sevenAm, 16)).toBe('today')
  })

  it('still says today for a collection whose morning has passed', () => {
    // Better than silently promoting the next one: the bins may still be out.
    const sixPm = new Date('2026-09-17T18:00:00')

    expect(urgencyFor(collection('2026-09-17'), sixPm, 16)).toBe('today')
  })

  it('does not shout about something days away', () => {
    const now = new Date('2026-09-16T18:00:00')

    expect(urgencyFor(collection('2026-09-24'), now, 16)).toBe('upcoming')
  })

  it('respects a household that puts the bins out earlier', () => {
    const twoPm = new Date('2026-09-16T14:00:00')

    expect(urgencyFor(collection('2026-09-17'), twoPm, 16)).toBe('tomorrow')
    expect(urgencyFor(collection('2026-09-17'), twoPm, 13)).toBe('tonight')
  })

  it('crosses a month boundary without losing the thread', () => {
    const lateSept = new Date('2026-09-30T19:00:00')

    expect(urgencyFor(collection('2026-10-01'), lateSept, 16)).toBe('tonight')
  })
})

describe('localDay', () => {
  it('formats the local calendar day, not a UTC one', () => {
    // 8pm on the 16th in a western timezone is already the 17th in UTC; the
    // bins do not care what UTC thinks.
    expect(localDay(new Date(2026, 8, 16, 20, 0, 0))).toBe('2026-09-16')
  })
})
