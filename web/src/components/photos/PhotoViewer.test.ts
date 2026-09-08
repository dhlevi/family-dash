import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PhotoViewer from './PhotoViewer.vue'
import type { Photo } from '@/api/types'

/**
 * The full-screen viewer, and the slideshow it turns into.
 *
 * This is the part of the app that runs unattended for hours on a kitchen
 * wall, so the behaviour worth pinning down is what happens at the ends of
 * the list and what happens to the clock when somebody walks past and taps.
 */
function photo(index: number, overrides: Partial<Photo> = {}): Photo {
  return {
    id: `photo-${index}`,
    album: 'Holiday',
    filename: `beach-${index}.jpg`,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 1200,
    sizeBytes: 1024,
    takenAt: `2026-07-${String(index + 10).padStart(2, '0')}T12:00:00.000Z`,
    url: `/media/photos/photo-${index}?v=1`,
    thumbUrl: `/media/thumbs/photo-${index}?v=1`,
    favourite: false,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides
  }
}

const three = [photo(0), photo(1), photo(2)]

function mountViewer(props: Partial<InstanceType<typeof PhotoViewer>['$props']> = {}) {
  return mount(PhotoViewer, {
    props: { photos: three, index: 0, intervalSeconds: 20, ...props },
    global: { stubs: { Spinner: true } }
  })
}

type Viewer = ReturnType<typeof mountViewer>

const emittedIndexes = (wrapper: Viewer) =>
  ((wrapper.emitted('update:index') ?? []) as number[][]).map(([index]) => index)

const click = (wrapper: Viewer, label: string) => wrapper.get(`[aria-label="${label}"]`).trigger('click')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PhotoViewer navigation', () => {
  it('shows which picture this is and what it is called', () => {
    const wrapper = mountViewer({ index: 1 })

    expect(wrapper.text()).toContain('beach-1.jpg')
    expect(wrapper.text()).toContain('2 of 3')
  })

  it('moves forwards and backwards', async () => {
    const wrapper = mountViewer({ index: 1 })

    await click(wrapper, 'Next photo')
    await click(wrapper, 'Previous photo')

    expect(emittedIndexes(wrapper)).toEqual([2, 0])
  })

  it('wraps at both ends, so it can cycle all evening', async () => {
    const last = mountViewer({ index: 2 })
    await click(last, 'Next photo')
    expect(emittedIndexes(last)).toEqual([0])

    const first = mountViewer({ index: 0 })
    await click(first, 'Previous photo')
    expect(emittedIndexes(first)).toEqual([2])
  })

  it('offers no navigation for a single picture', () => {
    const wrapper = mountViewer({ photos: [photo(0)] })

    expect(wrapper.find('[aria-label="Next photo"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Play a slideshow"]').exists()).toBe(false)
  })

  it('answers the arrow keys and escape, for a keyboard or a remote', async () => {
    const wrapper = mountViewer({ index: 1 })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(emittedIndexes(wrapper)).toEqual([2, 0])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('stops listening to the keyboard once closed', async () => {
    const wrapper = mountViewer()
    wrapper.unmount()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await nextTick()

    expect(wrapper.emitted('update:index')).toBeUndefined()
  })
})

describe('PhotoViewer slideshow', () => {
  it('does not advance until it is started', async () => {
    const wrapper = mountViewer()

    vi.advanceTimersByTime(60_000)
    await nextTick()

    expect(emittedIndexes(wrapper)).toEqual([])
  })

  it('advances on the configured interval once playing', async () => {
    const wrapper = mountViewer({ intervalSeconds: 5 })

    await click(wrapper, 'Play a slideshow')
    vi.advanceTimersByTime(5_000)
    await nextTick()

    expect(emittedIndexes(wrapper)).toEqual([1])
  })

  it('starts advancing straight away when opened as a slideshow', async () => {
    const wrapper = mountViewer({ intervalSeconds: 5, autoPlay: true })

    vi.advanceTimersByTime(5_000)
    await nextTick()

    expect(emittedIndexes(wrapper)).toEqual([1])
  })

  it('gives the next picture a full turn after a manual tap', async () => {
    const wrapper = mountViewer({ intervalSeconds: 10, autoPlay: true })

    vi.advanceTimersByTime(8_000)
    await click(wrapper, 'Next photo')

    // The two seconds left on the old clock must not carry over, or a tap
    // would be followed by the picture changing again immediately.
    vi.advanceTimersByTime(2_000)
    await nextTick()
    expect(emittedIndexes(wrapper)).toEqual([1])

    vi.advanceTimersByTime(8_000)
    await nextTick()
    expect(emittedIndexes(wrapper)).toEqual([1, 1])
  })

  it('never advances faster than three seconds, whatever it is told', async () => {
    // The setting cannot go below 3, but a stale value must not spin.
    const wrapper = mountViewer({ intervalSeconds: 0, autoPlay: true })

    vi.advanceTimersByTime(2_500)
    await nextTick()
    expect(emittedIndexes(wrapper)).toEqual([])

    vi.advanceTimersByTime(600)
    await nextTick()
    expect(emittedIndexes(wrapper)).toEqual([1])
  })

  it('stops the clock when it is closed', async () => {
    const wrapper = mountViewer({ intervalSeconds: 5, autoPlay: true })
    wrapper.unmount()

    vi.advanceTimersByTime(30_000)

    expect(wrapper.emitted('update:index')).toBeUndefined()
  })
})

describe('PhotoViewer actions', () => {
  it('reports a favourite being set for the picture on screen', async () => {
    const wrapper = mountViewer({ index: 1 })

    await click(wrapper, 'Make a favourite')

    expect(wrapper.emitted('favourite')).toEqual([[three[1], true]])
  })

  it('asks before deleting, because the file goes with it', async () => {
    const wrapper = mountViewer()

    await click(wrapper, 'Delete this photo')
    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.text()).toContain('Delete this photo?')

    await wrapper.get('[aria-label="Delete this photo?"] button:last-of-type').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([[three[0]]])
  })

  it('explains a HEIC that could not be converted, rather than showing a broken image', async () => {
    const wrapper = mountViewer({ photos: [photo(0, { mimeType: 'image/heic', filename: 'IMG_4021.HEIC' })] })

    await wrapper.get('img').trigger('error')

    expect(wrapper.text()).toContain('HEIC pictures need converting')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('blames the volume for any other picture that will not load', async () => {
    const wrapper = mountViewer()

    await wrapper.get('img').trigger('error')

    expect(wrapper.text()).toContain('removed from the media volume')
  })
})
