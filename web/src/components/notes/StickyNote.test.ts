import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import StickyNoteCard from './StickyNote.vue'
import type { StickyNote } from '@/api/types'

/**
 * A note has to be both draggable and tappable from the same press, and
 * getting the split wrong is the kind of bug that makes a touchscreen feel
 * broken: either every move opens the editor, or the note cannot be opened
 * at all.
 */
const BOARD = { boardWidth: 1000, boardHeight: 500 }

function note(overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id: 'note-1',
    kind: 'text',
    body: 'Swimming kit in the blue bag',
    colour: '#ffe066',
    x: 0.2,
    y: 0.2,
    zIndex: 3,
    pinned: false,
    strokes: [],
    inkWidth: null,
    inkHeight: null,
    createdAt: '2026-09-07T12:00:00.000Z',
    updatedAt: '2026-09-07T12:00:00.000Z',
    ...overrides
  }
}

function mountNote(overrides: Partial<StickyNote> = {}) {
  return mount(StickyNoteCard, { props: { note: note(overrides), ...BOARD } })
}

/** The root element is the drag surface. */
const surface = (wrapper: ReturnType<typeof mountNote>) => wrapper.get('[role="button"]')

/**
 * Dispatches a pointer event carrying the fields the component reads.
 *
 * jsdom exposes `button` as a getter on MouseEvent, so test-utils' `trigger`
 * cannot set it, and jsdom has no PointerEvent to carry `pointerId`. A plain
 * Event with the properties assigned is what the handlers actually need.
 */
async function pointer(
  wrapper: ReturnType<typeof mountNote>,
  type: string,
  props: Record<string, unknown>
): Promise<void> {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { button: 0, ...props })
  surface(wrapper).element.dispatchEvent(event)
  await nextTick()
}

describe('StickyNote interaction', () => {
  it('treats a press that barely moves as a tap and opens the note', async () => {
    const wrapper = mountNote()

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    // Two pixels of wobble is a finger, not a drag.
    await pointer(wrapper, 'pointermove', { pointerId: 1, clientX: 102, clientY: 101 })
    await pointer(wrapper, 'pointerup', { pointerId: 1 })

    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('treats a press that travels as a drag and never opens the note', async () => {
    const wrapper = mountNote()

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    await pointer(wrapper, 'pointermove', { pointerId: 1, clientX: 200, clientY: 150 })
    await pointer(wrapper, 'pointerup', { pointerId: 1 })

    expect(wrapper.emitted('open')).toBeUndefined()
    expect(wrapper.emitted('move')).toHaveLength(1)
  })

  it('reports the new position as a fraction of the board', async () => {
    const wrapper = mountNote({ x: 0.2, y: 0.2 })

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    // +100px of 1000 wide is +0.1; +50px of 500 tall is +0.1.
    await pointer(wrapper, 'pointermove', { pointerId: 1, clientX: 200, clientY: 150 })
    await pointer(wrapper, 'pointerup', { pointerId: 1 })

    const payload = wrapper.emitted('move')?.[0]?.[0] as { x: number; y: number }
    expect(payload.x).toBeCloseTo(0.3, 5)
    expect(payload.y).toBeCloseTo(0.3, 5)
  })

  it('clamps a drag to the board so a note cannot be lost off the edge', async () => {
    const wrapper = mountNote({ x: 0.5, y: 0.5 })

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 500, clientY: 250 })
    await pointer(wrapper, 'pointermove', { pointerId: 1, clientX: -5000, clientY: -5000 })
    await pointer(wrapper, 'pointerup', { pointerId: 1 })

    const payload = wrapper.emitted('move')?.[0]?.[0] as { x: number; y: number }
    expect(payload.x).toBe(0)
    expect(payload.y).toBe(0)
  })

  it('ignores pointer events from a second finger mid-drag', async () => {
    const wrapper = mountNote()

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    // A second contact must not start a competing drag or end the first one.
    await pointer(wrapper, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 400 })
    await pointer(wrapper, 'pointermove', { pointerId: 2, clientX: 500, clientY: 450 })
    await pointer(wrapper, 'pointerup', { pointerId: 2 })

    expect(wrapper.emitted('move')).toBeUndefined()
    expect(wrapper.emitted('open')).toBeUndefined()

    // The original pointer still finishes its own gesture.
    await pointer(wrapper, 'pointerup', { pointerId: 1 })
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('discards a cancelled drag rather than moving the note', async () => {
    const wrapper = mountNote()

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    await pointer(wrapper, 'pointermove', { pointerId: 1, clientX: 300, clientY: 200 })
    await pointer(wrapper, 'pointercancel', { pointerId: 1 })

    expect(wrapper.emitted('move')).toBeUndefined()
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('ignores a right-click', async () => {
    const wrapper = mountNote()

    await pointer(wrapper, 'pointerdown', { pointerId: 1, button: 2, clientX: 100, clientY: 100 })
    await pointer(wrapper, 'pointerup', { pointerId: 1 })

    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('does not respond while busy', async () => {
    const wrapper = mount(StickyNoteCard, { props: { note: note(), ...BOARD, busy: true } })

    await pointer(wrapper, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    await pointer(wrapper, 'pointerup', { pointerId: 1 })

    expect(wrapper.emitted('open')).toBeUndefined()
  })
})

describe('StickyNote rendering', () => {
  it('positions itself by board fraction', () => {
    const wrapper = mountNote({ x: 0.25, y: 0.6 })
    const style = surface(wrapper).attributes('style') ?? ''

    expect(style).toContain('left: 25%')
    expect(style).toContain('top: 60%')
  })

  it('shows the text of a typed note', () => {
    expect(mountNote().text()).toContain('Swimming kit in the blue bag')
  })

  it('renders handwriting as SVG rather than text', () => {
    const wrapper = mountNote({
      kind: 'ink',
      body: '',
      inkWidth: 320,
      inkHeight: 240,
      strokes: [
        {
          colour: '#1a1f2b',
          width: 3,
          points: [
            { x: 10, y: 10, p: 0.5 },
            { x: 40, y: 60, p: 0.6 }
          ]
        }
      ]
    })

    // The pin icon is also an svg, so pick the one framing the capture space.
    const ink = wrapper.findAll('svg').find(svg => svg.attributes('viewBox') === '0 0 320 240')

    expect(ink, "expected an svg with the note's capture viewBox").toBeDefined()
    expect(ink!.findAll('path').length).toBeGreaterThan(0)
  })

  it('shows a caption under handwriting when there is one', () => {
    const wrapper = mountNote({
      kind: 'ink',
      body: 'Shopping list',
      inkWidth: 320,
      inkHeight: 240,
      strokes: [{ colour: '#1a1f2b', width: 3, points: [{ x: 10, y: 10, p: 0.5 }] }]
    })

    expect(wrapper.text()).toContain('Shopping list')
  })

  it('offers pinning without dragging the note', async () => {
    const wrapper = mountNote()
    const pin = wrapper.get('button[aria-pressed]')

    await pin.trigger('click')

    expect(wrapper.emitted('togglePin')).toHaveLength(1)
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('gives each note a stable tilt derived from its id', () => {
    const first = mountNote({ id: '9f2c1a44-0000-4000-8000-000000000001' })
    const second = mountNote({ id: '9f2c1a44-0000-4000-8000-000000000001' })
    const third = mountNote({ id: '7b81e0c2-0000-4000-8000-000000000002' })

    const tiltOf = (w: ReturnType<typeof mountNote>) =>
      /rotate\(([-\d.]+)deg\)/.exec(surface(w).attributes('style') ?? '')?.[1]

    // Same id, same tilt on every render — the board must not jitter.
    expect(tiltOf(first)).toBe(tiltOf(second))
    expect(tiltOf(first)).not.toBe(tiltOf(third))
  })
})
