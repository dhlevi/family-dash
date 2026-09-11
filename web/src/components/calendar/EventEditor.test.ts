import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import EventEditor from './EventEditor.vue'
import type { CalendarEvent, CalendarSource } from '@/api/types'

/**
 * The editor is where repeating gets set up and, more dangerously, taken
 * apart: "delete this one" and "delete all of them" look identical until the
 * moment they happen. These pin down that a one-off still deletes on one tap
 * and a series never does.
 */
const sources: CalendarSource[] = [
  {
    id: 'local-1',
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
    id: 'google-1',
    type: 'google',
    name: 'Work',
    colour: '#48b884',
    enabled: true,
    readOnly: false,
    lastSyncAt: null,
    lastError: null,
    config: {}
  }
]

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    sourceId: 'local-1',
    externalUid: null,
    title: 'Swimming',
    description: null,
    location: null,
    startsAt: '2026-09-15T17:00:00.000Z',
    endsAt: '2026-09-15T18:00:00.000Z',
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

/**
 * The modal teleports to `body`, so the rendered form is not inside the
 * wrapper's element and has to be read off the document.
 */
let editor: VueWrapper | null = null

function mountEditor(props: Partial<InstanceType<typeof EventEditor>['$props']> = {}) {
  editor = mount(EventEditor, {
    props: { open: true, event: null, defaultDay: null, sources, ...props },
    attachTo: document.body
  })

  return editor
}

afterEach(() => {
  editor?.unmount()
  editor = null
  document.body.innerHTML = ''
})

const shown = (): string => document.body.textContent ?? ''
const buttons = (): HTMLButtonElement[] => [...document.body.querySelectorAll('button')]
const labels = (): string[] => buttons().map(button => (button.textContent ?? '').trim())

async function press(label: string): Promise<void> {
  const button = buttons().find(candidate => (candidate.textContent ?? '').trim() === label)
  if (!button) throw new Error(`No button labelled '${label}'. Saw: ${labels().join(', ')}`)

  button.click()
  await nextTick()
}

describe('EventEditor recurrence', () => {
  it('offers repeating on the local calendar', async () => {
    mountEditor()
    await nextTick()

    expect(shown()).toContain('Repeats')
  })

  it('does not offer it for a calendar we only push single events to', async () => {
    // Inventing a repeat rule upstream would create a series this app could
    // not then keep in step, so the API refuses it and the UI does not ask.
    mountEditor({ event: event({ sourceId: 'google-1' }) })
    await nextTick()

    expect(shown()).not.toContain('Repeats')
  })

  it('deletes a one-off on the first tap, as it always did', async () => {
    const wrapper = mountEditor({ event: event() })
    await nextTick()

    await press('Delete')

    expect(wrapper.emitted('remove')?.[0]?.[1]).toBe('series')
  })

  it('asks which when the event repeats', async () => {
    const wrapper = mountEditor({ event: event({ recurrence: 'weekly', seriesId: 'event-1' }) })
    await nextTick()

    await press('Delete')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(labels()).toEqual(expect.arrayContaining(['This one', 'All of them', 'Keep']))
  })

  it('passes the scope the person actually chose', async () => {
    const wrapper = mountEditor({ event: event({ recurrence: 'weekly', seriesId: 'event-1' }) })
    await nextTick()

    await press('Delete')
    await press('This one')

    expect(wrapper.emitted('remove')?.[0]?.[1]).toBe('occurrence')
  })

  it('backs out of the choice without deleting anything', async () => {
    const wrapper = mountEditor({ event: event({ recurrence: 'weekly', seriesId: 'event-1' }) })
    await nextTick()

    await press('Delete')
    await press('Keep')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(labels()).toContain('Delete')
  })

  it('shows the series dates, not the occurrence that was opened', async () => {
    // Saving without touching anything must not move the series onto the date
    // of whichever occurrence happened to be tapped.
    const wrapper = mountEditor({
      event: event({
        recurrence: 'weekly',
        seriesId: 'event-1',
        startsAt: '2026-10-06T17:00:00.000Z',
        endsAt: '2026-10-06T18:00:00.000Z',
        seriesStartsAt: '2026-09-15T17:00:00.000Z'
      })
    })
    await nextTick()

    await press('Save')
    const saved = wrapper.emitted('save')?.[0]?.[0] as { startsAt: string; endsAt: string }

    expect(saved.startsAt).toBe('2026-09-15T17:00:00.000Z')
    // And the hour-long duration is preserved, not recomputed from the tap.
    expect(new Date(saved.endsAt).getTime() - new Date(saved.startsAt).getTime()).toBe(3_600_000)
  })

  it('warns that an edit reaches every occurrence', async () => {
    mountEditor({ event: event({ recurrence: 'weekly', seriesId: 'event-1' }) })
    await nextTick()

    expect(shown()).toContain('Changes here apply to every occurrence')
  })

  it('sends the recurrence when one is chosen', async () => {
    const wrapper = mountEditor({ event: event({ recurrence: 'weekly', seriesId: 'event-1', title: 'Swimming' }) })
    await nextTick()

    await press('Save')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ recurrence: 'weekly' })
  })
})
