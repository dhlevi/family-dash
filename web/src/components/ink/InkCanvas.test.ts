import { mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import InkCanvas from './InkCanvas.vue'
import type { InkStroke } from '@/api/types'

/**
 * Undo has to reverse whichever thing happened last.
 *
 * The first version of this component kept a stack of strokes, which is
 * enough while drawing is the only operation. Adding the eraser broke it
 * silently: undoing an erase has to *restore* strokes, so an undo after a
 * swipe removed a drawn stroke instead of putting the erased ones back.
 * These tests pin down the operation semantics that replaced it.
 */
const SURFACE = { width: 640, height: 480 }

/** The size the stubbed layout reports. Changed to simulate a rotation. */
let measured = { ...SURFACE }

/** Callbacks the component registered, so a test can fire a resize itself. */
let observers: (() => void)[] = []

beforeAll(() => {
  // jsdom lays nothing out, so the component would measure a 1x1 surface and
  // rescale every stroke into it. A fixed rect at the origin also makes
  // client coordinates and surface coordinates the same thing.
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: measured.width,
      bottom: measured.height,
      ...measured
    }) as DOMRect

  // jsdom has no ResizeObserver at all, and without one the component never
  // notices the screen turning.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback)
      }
      public observe(): void {}
      public disconnect(): void {}
    }
  )
})

beforeEach(() => {
  measured = { ...SURFACE }
  observers = []
})

/** Turns the screen, as the Pi's display does on its mount. */
async function rotate(width: number, height: number): Promise<void> {
  measured = { width, height }
  for (const notify of observers) notify()
  await nextTick()
}

function mountCanvas() {
  return mount(InkCanvas, {
    props: {
      modelValue: [],
      surfaceWidth: SURFACE.width,
      surfaceHeight: SURFACE.height,
      allowErase: true
    }
  })
}

type Canvas = ReturnType<typeof mountCanvas>

// Scoped by label rather than by tag: the toolbar icons are SVGs too.
const surfaceOf = (wrapper: Canvas) => wrapper.get('[aria-label="Drawing surface"]')

/**
 * Dispatches a pointer event carrying the fields the handlers read.
 *
 * jsdom has no PointerEvent and exposes `button` as a getter that
 * test-utils' `trigger` cannot set, so a plain Event with the properties
 * assigned is what actually works.
 */
async function pointer(wrapper: Canvas, type: string, props: Record<string, unknown>): Promise<void> {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { button: 0, pointerId: 1, pointerType: 'mouse', pressure: 0.5, ...props })
  surfaceOf(wrapper).element.dispatchEvent(event)
  await nextTick()
}

/** Draws one horizontal stroke at height `y`, from `x` to `x + length`. */
async function drawLine(wrapper: Canvas, y: number, x = 40, length = 200): Promise<void> {
  await pointer(wrapper, 'pointerdown', { clientX: x, clientY: y })
  for (let step = 20; step <= length; step += 20) {
    await pointer(wrapper, 'pointermove', { clientX: x + step, clientY: y })
  }
  await pointer(wrapper, 'pointerup', { clientX: x + length, clientY: y })
}

/** Swipes the eraser down through everything `drawLine` drew. */
async function eraseDown(wrapper: Canvas, x = 100, from = 0, to = 480): Promise<void> {
  await wrapper.get('[aria-label="Eraser"]').trigger('click')
  await pointer(wrapper, 'pointerdown', { clientX: x, clientY: from })
  for (let y = from + 20; y <= to; y += 20) {
    await pointer(wrapper, 'pointermove', { clientX: x, clientY: y })
  }
  await pointer(wrapper, 'pointerup', { clientX: x, clientY: to })
}

/** The strokes the component last reported, which is what a save would store. */
function emittedStrokes(wrapper: Canvas): InkStroke[] {
  const updates = wrapper.emitted('update:modelValue') as InkStroke[][][] | undefined
  return updates?.at(-1)?.[0] ?? []
}

const drawn = (wrapper: Canvas) => surfaceOf(wrapper).findAll('path').length

const click = async (wrapper: Canvas, label: string) => wrapper.get(`[aria-label="${label}"]`).trigger('click')

describe('InkCanvas drawing', () => {
  it('commits one stroke per pointer press', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)

    expect(drawn(wrapper)).toBe(2)
    expect(emittedStrokes(wrapper)).toHaveLength(2)
  })

  it('ignores a touch that lands while a stylus is in use', async () => {
    const wrapper = mountCanvas()

    await pointer(wrapper, 'pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 40, clientY: 100 })
    await pointer(wrapper, 'pointerup', { pointerId: 1, pointerType: 'pen', clientX: 40, clientY: 100 })

    // A palm resting beside the pen, a moment later.
    await pointer(wrapper, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 300 })
    await pointer(wrapper, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 360, clientY: 320 })
    await pointer(wrapper, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 360, clientY: 320 })

    expect(drawn(wrapper)).toBe(1)
  })
})

describe('InkCanvas history', () => {
  it('undoes one drawn stroke at a time, and redoes it', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)
    await drawLine(wrapper, 300)

    await click(wrapper, 'Undo')
    expect(drawn(wrapper)).toBe(2)

    await click(wrapper, 'Redo')
    expect(drawn(wrapper)).toBe(3)
  })

  it('restores everything an eraser swipe removed in a single undo', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)
    await drawLine(wrapper, 300)
    // Out of the swipe's path, so it survives and proves the eraser is
    // selective rather than clearing the canvas.
    await drawLine(wrapper, 400, 400)

    expect(drawn(wrapper)).toBe(4)

    await eraseDown(wrapper)
    expect(drawn(wrapper)).toBe(1)

    // One undo, not three: the swipe was one action.
    await click(wrapper, 'Undo')
    expect(drawn(wrapper)).toBe(4)
    expect(emittedStrokes(wrapper)).toHaveLength(4)

    await click(wrapper, 'Redo')
    expect(drawn(wrapper)).toBe(1)
  })

  it('undoes a draw made after an erase without disturbing the erase', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)
    await eraseDown(wrapper)
    expect(drawn(wrapper)).toBe(0)

    await click(wrapper, 'Pen')
    await drawLine(wrapper, 400, 400)
    expect(drawn(wrapper)).toBe(1)

    // The newest operation is the draw, so this takes back only that.
    await click(wrapper, 'Undo')
    expect(drawn(wrapper)).toBe(0)

    // And this one reaches back past it to the erase.
    await click(wrapper, 'Undo')
    expect(drawn(wrapper)).toBe(2)
  })

  it('recovers a mis-tapped Clear', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)
    await click(wrapper, 'Clear')

    expect(drawn(wrapper)).toBe(0)

    await click(wrapper, 'Undo')
    expect(drawn(wrapper)).toBe(2)
  })

  it('drops the redo history once something new is drawn', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await click(wrapper, 'Undo')
    await drawLine(wrapper, 300)

    // Redoing the abandoned stroke now would interleave it with a drawing
    // that never contained it.
    expect(wrapper.get('[aria-label="Redo"]').attributes('disabled')).toBeDefined()
    expect(drawn(wrapper)).toBe(1)
  })

  it('offers nothing to undo on an untouched canvas', async () => {
    const wrapper = mountCanvas()

    expect(wrapper.get('[aria-label="Undo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Redo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Clear"]').attributes('disabled')).toBeDefined()
  })
})

/**
 * The display is wall-mounted and can be turned, so the surface can change
 * shape with ink on it. Strokes are rescaled into the new space, which makes
 * new objects — and history identifies strokes by reference, so it has to be
 * carried across or undo silently stops working.
 */
describe('InkCanvas across a rotation', () => {
  it('rescales the ink into the new shape', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 240, 0, 320)
    await rotate(1280, 960)

    // Twice as wide and twice as tall, so the ink doubles with it and stays
    // in the same place on the page.
    const [stroke] = emittedStrokes(wrapper)
    expect(stroke!.points[0]!.x).toBeCloseTo(0)
    expect(stroke!.points[0]!.y).toBeCloseTo(480)
    expect(stroke!.points.at(-1)!.x).toBeCloseTo(640)
    expect(surfaceOf(wrapper).attributes('viewBox')).toBe('0 0 1280 960')
  })

  it('can still undo a stroke drawn before the screen turned', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)
    await rotate(480, 640)

    await click(wrapper, 'Undo')
    expect(drawn(wrapper)).toBe(1)
  })

  it('puts erased strokes back in the new shape, not the old one', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await drawLine(wrapper, 200)
    await eraseDown(wrapper)
    expect(drawn(wrapper)).toBe(0)

    // Nothing is on the canvas now, but two strokes are waiting in history
    // — they have to be rescaled too, or they come back in the wrong place.
    await rotate(1280, 960)
    await click(wrapper, 'Undo')

    expect(drawn(wrapper)).toBe(2)
    const restored = emittedStrokes(wrapper)
    expect(restored).toHaveLength(2)
    expect(restored[0]!.points[0]!.x).toBeCloseTo(80)
    expect(restored[0]!.points[0]!.y).toBeCloseTo(200)
  })

  it('recovers a Clear made before the screen turned', async () => {
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)
    await click(wrapper, 'Clear')
    await rotate(1280, 960)
    await click(wrapper, 'Undo')

    expect(drawn(wrapper)).toBe(1)
    expect(emittedStrokes(wrapper)[0]!.points[0]!.y).toBeCloseTo(200)
  })
})

describe('InkCanvas before it has been laid out', () => {
  it('ignores a pointer on a surface with no area', async () => {
    // Dividing a client coordinate by a zero width gives Infinity, which
    // reaches the DOM as `M Infinity Infinity` and logs an SVG error.
    measured = { width: 0, height: 0 }
    const wrapper = mountCanvas()

    await drawLine(wrapper, 100)

    expect(drawn(wrapper)).toBe(0)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    // And it draws normally once there is something to draw on.
    await rotate(640, 480)
    await drawLine(wrapper, 100)

    expect(drawn(wrapper)).toBe(1)
    const point = emittedStrokes(wrapper)[0]!.points[0]!
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
  })

  it('keeps the strokes it was given when the surface has no size yet', async () => {
    // What the note editor does: the canvas mounts inside a modal that is
    // still transitioning in, so its first measurement is of nothing.
    measured = { width: 0, height: 0 }

    const existing = [{ colour: '#1a1f2b', width: 4, points: [{ x: 100, y: 80, p: 0.5 }] }]
    const wrapper = mount(InkCanvas, {
      props: { modelValue: existing, surfaceWidth: 400, surfaceHeight: 300, allowErase: true }
    })
    await nextTick()

    // Squashing into a 1x1 space and back out again would lose the ink.
    expect(surfaceOf(wrapper).attributes('viewBox')).toBe('0 0 400 300')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await rotate(800, 600)

    expect(surfaceOf(wrapper).attributes('viewBox')).toBe('0 0 800 600')
    expect(emittedStrokes(wrapper)[0]!.points[0]).toMatchObject({ x: 200, y: 160 })
  })
})
