import { describe, expect, it } from 'vitest'
import { expand, expandAll, occurrenceId, parseOccurrenceId } from '../../lib/services/EventSeries'
import type { CalendarEvent } from '../../lib/types/domain'

/**
 * Expansion is where a repeating event either behaves or quietly goes wrong
 * months later, so the cases here are the ones that bite: the clocks changing,
 * the 31st of a month, and an occurrence somebody cancelled.
 */
function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'series-1',
    sourceId: 'source-1',
    externalUid: null,
    title: 'Swimming',
    description: null,
    location: null,
    startsAt: '2026-09-01T17:00:00.000Z',
    endsAt: '2026-09-01T18:00:00.000Z',
    allDay: false,
    rrule: null,
    recurrence: 'weekly',
    recurrenceUntil: null,
    seriesId: 'series-1',
    seriesStartsAt: '2026-09-01T17:00:00.000Z',
    colour: null,
    ...overrides
  }
}

const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) })

describe('occurrence ids', () => {
  it('round-trips', () => {
    const start = new Date('2026-09-08T17:00:00.000Z')
    const parsed = parseOccurrenceId(occurrenceId('series-1', start))

    expect(parsed?.seriesId).toBe('series-1')
    expect(parsed?.startsAt.toISOString()).toBe(start.toISOString())
  })

  it('says nothing about an ordinary event id', () => {
    expect(parseOccurrenceId('b2c3d4e5-0000-4000-8000-000000000000')).toBeNull()
  })

  it('rejects a composite id with an unreadable date', () => {
    expect(parseOccurrenceId('series-1::not-a-date')).toBeNull()
  })
})

describe('expand', () => {
  it('returns a one-off unchanged when it overlaps', () => {
    const once = event({ recurrence: null, seriesId: null })

    expect(expand(once, range('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'))).toEqual([once])
  })

  it('drops a one-off that falls outside the range', () => {
    const once = event({ recurrence: null, seriesId: null })

    expect(expand(once, range('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'))).toEqual([])
  })

  it('produces every weekly occurrence inside the range', () => {
    const found = expand(event(), range('2026-09-01T00:00:00Z', '2026-09-29T00:00:00Z'))

    expect(found.map(entry => entry.startsAt.slice(0, 10))).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22'
    ])
  })

  it('finds occurrences of a series that began long before the range', () => {
    // The whole reason the range query cannot rely on overlap.
    const found = expand(event(), range('2026-12-01T00:00:00Z', '2026-12-15T00:00:00Z'))

    expect(found).toHaveLength(2)
    expect(found[0]?.startsAt.slice(0, 10)).toBe('2026-12-01')
  })

  it('tells every occurrence where its series began', () => {
    // The editor applies an edit to the whole series, so it has to show the
    // series' own dates rather than the occurrence that was tapped.
    const found = expand(event(), range('2026-12-01T00:00:00Z', '2026-12-15T00:00:00Z'))

    expect(found.every(entry => entry.seriesStartsAt === '2026-09-01T17:00:00.000Z')).toBe(true)
    expect(found[0]?.startsAt).not.toBe(found[0]?.seriesStartsAt)
  })

  it('keeps the stored id for the first occurrence and composes the rest', () => {
    // The first is the row the editor opens; giving it a composite id would
    // make a one-off and the first of a series behave differently.
    const found = expand(event(), range('2026-09-01T00:00:00Z', '2026-09-16T00:00:00Z'))

    expect(found[0]?.id).toBe('series-1')
    expect(found[1]?.id).toBe('series-1::2026-09-08T17:00:00.000Z')
    expect(found.every(entry => entry.seriesId === 'series-1')).toBe(true)
  })

  it('carries the duration onto every occurrence', () => {
    const long = event({ endsAt: '2026-09-01T20:30:00.000Z' })
    const found = expand(long, range('2026-09-01T00:00:00Z', '2026-09-16T00:00:00Z'))

    for (const entry of found) {
      const minutes = (new Date(entry.endsAt).getTime() - new Date(entry.startsAt).getTime()) / 60_000
      expect(minutes).toBe(210)
    }
  })

  it('stops at the end of the series', () => {
    const ending = event({ recurrenceUntil: '2026-09-16T00:00:00.000Z' })
    const found = expand(ending, range('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'))

    expect(found.map(entry => entry.startsAt.slice(0, 10))).toEqual(['2026-09-01', '2026-09-08', '2026-09-15'])
  })

  it('leaves out an occurrence that was cancelled', () => {
    const found = expand(event(), range('2026-09-01T00:00:00Z', '2026-09-29T00:00:00Z'), [
      new Date('2026-09-08T17:00:00.000Z')
    ])

    expect(found.map(entry => entry.startsAt.slice(0, 10))).toEqual(['2026-09-01', '2026-09-15', '2026-09-22'])
  })

  it('includes an occurrence still running when the range opens', () => {
    // A three-hour event that began an hour before "now" is still on.
    const found = expand(
      event({ endsAt: '2026-09-01T20:00:00.000Z' }),
      range('2026-09-01T18:00:00Z', '2026-09-01T19:00:00Z')
    )

    expect(found).toHaveLength(1)
  })

  it('walks weekdays without landing on a weekend', () => {
    // 2026-09-04 is a Friday; the next weekday is Monday the 7th.
    const daily = event({
      recurrence: 'weekdays',
      startsAt: '2026-09-04T17:00:00.000Z',
      endsAt: '2026-09-04T18:00:00.000Z'
    })
    const found = expand(daily, range('2026-09-04T00:00:00Z', '2026-09-09T00:00:00Z'))

    expect(found.map(entry => entry.startsAt.slice(0, 10))).toEqual(['2026-09-04', '2026-09-07', '2026-09-08'])
  })

  it('clamps a monthly series to the end of a short month', () => {
    // Without clamping, 31 January plus a month lands in March and the series
    // drifts a few days later every month thereafter.
    const monthly = event({
      recurrence: 'monthly',
      allDay: true,
      startsAt: '2027-01-31T00:00:00.000Z',
      endsAt: '2027-02-01T00:00:00.000Z'
    })
    const found = expand(monthly, range('2027-01-01T00:00:00Z', '2027-05-01T00:00:00Z'))

    expect(found.map(entry => entry.startsAt.slice(0, 10))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30'
    ])
  })

  it('keeps an all-day series on midnight across a clock change', () => {
    // All-day events are stored at UTC midnight so they mean the same calendar
    // date everywhere. Advancing them in local time would shift them off it
    // the first time the clocks went back.
    const allDay = event({
      recurrence: 'weekly',
      allDay: true,
      startsAt: '2026-10-25T00:00:00.000Z',
      endsAt: '2026-10-26T00:00:00.000Z'
    })
    const found = expand(allDay, range('2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z'))

    for (const entry of found) expect(entry.startsAt).toMatch(/T00:00:00\.000Z$/)
  })

  it('cannot run away on a corrupt series', () => {
    const daily = event({
      recurrence: 'daily',
      startsAt: '1990-01-01T00:00:00.000Z',
      endsAt: '1990-01-01T01:00:00.000Z'
    })
    const found = expand(daily, range('1990-01-01T00:00:00Z', '2200-01-01T00:00:00Z'))

    expect(found.length).toBeLessThanOrEqual(2000)
  })
})

describe('expandAll', () => {
  it('interleaves series and one-offs in calendar order', () => {
    const series = event({ id: 'weekly', title: 'Swimming' })
    const once = event({
      id: 'once',
      title: 'Dentist',
      recurrence: null,
      seriesId: null,
      startsAt: '2026-09-09T09:00:00.000Z',
      endsAt: '2026-09-09T10:00:00.000Z'
    })

    const found = expandAll([series, once], range('2026-09-01T00:00:00Z', '2026-09-16T00:00:00Z'))

    expect(found.map(entry => `${entry.startsAt.slice(0, 10)} ${entry.title}`)).toEqual([
      '2026-09-01 Swimming',
      '2026-09-08 Swimming',
      '2026-09-09 Dentist',
      '2026-09-15 Swimming'
    ])
  })

  it('puts all-day events before timed ones on the same day', () => {
    const timed = event({
      id: 'timed',
      recurrence: null,
      seriesId: null,
      startsAt: '2026-09-01T09:00:00.000Z',
      endsAt: '2026-09-01T10:00:00.000Z'
    })
    const whole = event({
      id: 'whole',
      title: 'Holiday',
      recurrence: null,
      seriesId: null,
      allDay: true,
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-02T00:00:00.000Z'
    })

    const found = expandAll([timed, whole], range('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'))

    expect(found[0]?.title).toBe('Holiday')
  })

  it('applies the exceptions belonging to each series', () => {
    const a = event({ id: 'a', title: 'A' })
    const b = event({ id: 'b', title: 'B' })
    const exclusions = new Map([['a', [new Date('2026-09-08T17:00:00.000Z')]]])

    const found = expandAll([a, b], range('2026-09-01T00:00:00Z', '2026-09-16T00:00:00Z'), exclusions)

    expect(found.filter(entry => entry.title === 'A')).toHaveLength(2)
    expect(found.filter(entry => entry.title === 'B')).toHaveLength(3)
  })
})
