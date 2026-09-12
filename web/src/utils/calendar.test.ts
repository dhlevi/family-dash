import { describe, expect, it } from 'vitest'
import {
  agendaDays,
  colourFor,
  coversDay,
  eventEnd,
  eventStart,
  eventsByDay,
  fromAllDayInstant,
  isReadOnly,
  lastDayOf,
  toAllDayInstant
} from './calendar'
import { toDateInput } from './datetime'
import type { CalendarEvent, CalendarSource } from '@/api/types'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

/**
 * All-day events arrive from the API at UTC midnight, not local midnight —
 * that is what makes them mean the same calendar date in every timezone. The
 * fixtures have to be built that way or the tests pass while the UI is a day
 * out.
 */
const allDayIso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString()

function event(overrides: Partial<CalendarEvent> & { startsAt: string; endsAt: string }): CalendarEvent {
  return {
    id: 'e1',
    sourceId: 's1',
    externalUid: null,
    title: 'Event',
    description: null,
    location: null,
    allDay: false,
    rrule: null,
    recurrence: null,
    recurrenceUntil: null,
    seriesId: null,
    seriesStartsAt: null,
    colour: null,
    ...overrides
  }
}

describe('lastDayOf', () => {
  it("steps back over an all-day event's exclusive end", () => {
    // 20th to 21st exclusive is one day: the 20th.
    const single = event({
      allDay: true,
      startsAt: allDayIso(2026, 9, 20),
      endsAt: allDayIso(2026, 9, 21)
    })

    expect(lastDayOf(single)).toEqual(local(2026, 9, 20))
  })

  it('handles a multi-day all-day span', () => {
    const camping = event({
      allDay: true,
      startsAt: allDayIso(2026, 9, 26),
      endsAt: allDayIso(2026, 9, 28)
    })

    expect(lastDayOf(camping)).toEqual(local(2026, 9, 27))
  })

  it('does not go before the start for a degenerate all-day event', () => {
    const zeroLength = event({
      allDay: true,
      startsAt: allDayIso(2026, 9, 20),
      endsAt: allDayIso(2026, 9, 20)
    })

    expect(lastDayOf(zeroLength)).toEqual(local(2026, 9, 20))
  })

  it('keeps a timed event ending at midnight on the previous day', () => {
    const lateShift = event({
      startsAt: local(2026, 9, 20, 21).toISOString(),
      endsAt: local(2026, 9, 21, 0).toISOString()
    })

    expect(lastDayOf(lateShift)).toEqual(local(2026, 9, 20))
  })

  it('spans both days for a timed event crossing midnight', () => {
    const overnight = event({
      startsAt: local(2026, 9, 20, 22).toISOString(),
      endsAt: local(2026, 9, 21, 1).toISOString()
    })

    expect(lastDayOf(overnight)).toEqual(local(2026, 9, 21))
  })
})

describe('coversDay', () => {
  const camping = event({
    allDay: true,
    startsAt: allDayIso(2026, 9, 26),
    endsAt: allDayIso(2026, 9, 28)
  })

  it('covers every day it occupies', () => {
    expect(coversDay(camping, local(2026, 9, 26))).toBe(true)
    expect(coversDay(camping, local(2026, 9, 27))).toBe(true)
  })

  it('does not cover the exclusive end day or the day before it starts', () => {
    expect(coversDay(camping, local(2026, 9, 28))).toBe(false)
    expect(coversDay(camping, local(2026, 9, 25))).toBe(false)
  })

  it('ignores the time of day when matching', () => {
    const morning = event({
      startsAt: local(2026, 9, 15, 9).toISOString(),
      endsAt: local(2026, 9, 15, 10).toISOString()
    })

    expect(coversDay(morning, local(2026, 9, 15, 23, 30))).toBe(true)
  })
})

describe('eventsByDay', () => {
  const days = [local(2026, 9, 26), local(2026, 9, 27), local(2026, 9, 28)]

  it('repeats a multi-day event on each day it covers', () => {
    const camping = event({
      id: 'camp',
      allDay: true,
      startsAt: allDayIso(2026, 9, 26),
      endsAt: allDayIso(2026, 9, 28)
    })

    const byDay = eventsByDay([camping], days)

    expect(byDay.get(toDateInput(days[0]!))).toHaveLength(1)
    expect(byDay.get(toDateInput(days[1]!))).toHaveLength(1)
    expect(byDay.get(toDateInput(days[2]!))).toHaveLength(0)
  })

  it('includes an entry for every requested day, even empty ones', () => {
    const byDay = eventsByDay([], days)

    expect(byDay.size).toBe(3)
    expect([...byDay.values()].every(list => list.length === 0)).toBe(true)
  })

  it('sorts all-day events first, then by start time', () => {
    const day = local(2026, 9, 26)
    const events = [
      event({
        id: 'late',
        title: 'Late',
        startsAt: local(2026, 9, 26, 18).toISOString(),
        endsAt: local(2026, 9, 26, 19).toISOString()
      }),
      event({
        id: 'early',
        title: 'Early',
        startsAt: local(2026, 9, 26, 8).toISOString(),
        endsAt: local(2026, 9, 26, 9).toISOString()
      }),
      event({
        id: 'allday',
        title: 'All day',
        allDay: true,
        startsAt: allDayIso(2026, 9, 26),
        endsAt: allDayIso(2026, 9, 27)
      })
    ]

    const ordered = eventsByDay(events, [day])
      .get(toDateInput(day))!
      .map(e => e.title)

    expect(ordered).toEqual(['All day', 'Early', 'Late'])
  })
})

describe('agendaDays', () => {
  it('omits days with nothing on them', () => {
    const events = [
      event({ id: 'a', startsAt: local(2026, 9, 15, 17).toISOString(), endsAt: local(2026, 9, 15, 18).toISOString() }),
      event({ id: 'b', startsAt: local(2026, 9, 18, 12).toISOString(), endsAt: local(2026, 9, 18, 13).toISOString() })
    ]

    const agenda = agendaDays(events, local(2026, 9, 14), local(2026, 9, 20))

    expect(agenda).toHaveLength(2)
    expect(agenda.map(entry => entry.day.getDate())).toEqual([15, 18])
  })

  it('returns nothing when the range is empty of events', () => {
    expect(agendaDays([], local(2026, 9, 1), local(2026, 9, 30))).toHaveLength(0)
  })
})

describe('all-day instants', () => {
  it('round-trips a calendar date through UTC midnight', () => {
    const date = local(2026, 9, 20)

    expect(fromAllDayInstant(toAllDayInstant(date))).toEqual(date)
  })

  it('sends UTC midnight, whatever the local offset', () => {
    expect(toAllDayInstant(local(2026, 9, 20))).toBe('2026-09-20T00:00:00.000Z')
  })

  it('reads UTC midnight back as the same calendar date, not the previous evening', () => {
    // The bug this guards: in any negative-offset timezone,
    // `new Date('2026-09-20T00:00:00Z')` is the 19th, so an all-day event
    // rendered a day early.
    const read = fromAllDayInstant('2026-09-20T00:00:00.000Z')

    expect(read.getFullYear()).toBe(2026)
    expect(read.getMonth()).toBe(8)
    expect(read.getDate()).toBe(20)
    expect(read.getHours()).toBe(0)
  })

  it('places an all-day event on the day it names', () => {
    const proD = event({
      allDay: true,
      startsAt: '2026-09-20T00:00:00.000Z',
      endsAt: '2026-09-21T00:00:00.000Z'
    })

    expect(coversDay(proD, local(2026, 9, 20))).toBe(true)
    expect(coversDay(proD, local(2026, 9, 19))).toBe(false)
    expect(coversDay(proD, local(2026, 9, 21))).toBe(false)
  })

  it('leaves timed events as real instants', () => {
    const timed = event({
      startsAt: '2026-09-20T17:00:00.000Z',
      endsAt: '2026-09-20T18:00:00.000Z'
    })

    expect(eventStart(timed).toISOString()).toBe('2026-09-20T17:00:00.000Z')
    expect(eventEnd(timed).toISOString()).toBe('2026-09-20T18:00:00.000Z')
  })
})

describe('colourFor and isReadOnly', () => {
  const sources: CalendarSource[] = [
    {
      id: 's1',
      type: 'local',
      name: 'Family',
      colour: '#4f8ef7',
      enabled: true,
      readOnly: false,
      lastSyncAt: null,
      lastError: null,
      config: {}
    },
    {
      id: 's2',
      type: 'ics',
      name: 'School',
      colour: '#eda145',
      enabled: true,
      readOnly: true,
      lastSyncAt: null,
      lastError: null,
      config: { url: 'https://example.com/a.ics' }
    }
  ]

  it("prefers an event's own colour, else its source's", () => {
    const own = event({ colour: '#e5484d', startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-15T01:00:00Z' })
    const inherited = event({ sourceId: 's2', startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-15T01:00:00Z' })

    expect(colourFor(own, sources)).toBe('#e5484d')
    expect(colourFor(inherited, sources)).toBe('#eda145')
  })

  it('falls back to the accent when the source is unknown', () => {
    const orphan = event({ sourceId: 'gone', startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-15T01:00:00Z' })

    expect(colourFor(orphan, sources)).toBe('#4f8ef7')
  })

  it('treats a feed event as read-only however its source is configured', () => {
    const fromFeed = event({ externalUid: 'abc', startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-15T01:00:00Z' })
    const local = event({ startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-15T01:00:00Z' })

    expect(isReadOnly(fromFeed, sources)).toBe(true)
    expect(isReadOnly(local, sources)).toBe(false)
    expect(
      isReadOnly(event({ sourceId: 's2', startsAt: '2026-09-15T00:00:00Z', endsAt: '2026-09-15T01:00:00Z' }), sources)
    ).toBe(true)
  })
})
