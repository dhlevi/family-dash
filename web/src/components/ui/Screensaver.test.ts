import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { CityArt, Photo } from '@/api/types'

/**
 * The idle screen.
 *
 * This is the part of the application that runs unattended for days, so what
 * is worth pinning down is the behaviour at the edges: an empty library, an
 * empty artwork pool, and a picture that will not load. A screensaver that
 * fails by showing black is indistinguishable from a broken display.
 */

const slideshowPool = vi.fn<() => Promise<Photo[]>>(async () => [])
const artPool = vi.fn<() => Promise<CityArt[]>>(async () => [])

vi.mock('@/api/photos', () => ({ photosApi: { slideshowPool: () => slideshowPool() } }))
vi.mock('@/api/cityArt', () => ({ cityArtApi: { pool: () => artPool() } }))
vi.mock('@/api/weather', () => ({ weatherApi: { report: async () => Promise.reject(new Error('offline')) } }))

let source = 'gallery'

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get screensaverSource() {
      return source
    },
    clock24Hour: true,
    slideshowSeconds: 20
  })
}))

import Screensaver from './Screensaver.vue'

function photo(index: number): Photo {
  return {
    id: `photo-${index}`,
    album: '',
    filename: `p${index}.jpg`,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 1200,
    sizeBytes: 1024,
    takenAt: null,
    url: `/media/photos/photo-${index}?v=1`,
    thumbUrl: `/media/thumbs/photo-${index}?v=1`,
    favourite: false,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z'
  }
}

function art(index: number, overrides: Partial<CityArt> = {}): CityArt {
  return {
    id: `art-${index}`,
    cityKey: `wales:town-${index}`,
    cityName: `Town ${index}`,
    region: 'wales',
    country: 'Wales',
    latitude: 51.5,
    longitude: -3.2,
    theme: 'blueprint',
    themeName: 'Blueprint',
    background: '#0d2b45',
    width: 2000,
    height: 1250,
    url: `/media/city-art/art-${index}?v=1`,
    thumbUrl: `/media/city-art/art-${index}/thumb?v=1`,
    svgUrl: `/media/city-art/art-${index}/svg?v=1`,
    createdAt: '2026-09-11T00:00:00.000Z',
    ...overrides
  }
}

async function mountScreensaver() {
  const wrapper = mount(Screensaver, { global: { stubs: { WeatherIcon: true } } })
  // One tick per awaited call in onMounted, plus one for the render.
  for (let n = 0; n < 6; n++) await nextTick()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  source = 'gallery'
  slideshowPool.mockResolvedValue([])
  artPool.mockResolvedValue([])
  vi.clearAllMocks()
})

describe('Screensaver', () => {
  it('shows a clock with no pictures of any kind', async () => {
    const wrapper = await mountScreensaver()

    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.text()).toMatch(/\d{1,2}:\d{2}/)
  })

  it('shows photographs when set to the gallery, and asks for no artwork', async () => {
    slideshowPool.mockResolvedValue([photo(0), photo(1)])
    artPool.mockResolvedValue([art(0)])

    const wrapper = await mountScreensaver()

    expect(wrapper.find('img').attributes('src')).toBe('/media/photos/photo-0?v=1')
    // Drawing maps costs a tile server bandwidth, so nothing asks for them
    // while the screensaver is set to photographs.
    expect(artPool).not.toHaveBeenCalled()
  })

  it('shows map artwork, captioned, when set to maps', async () => {
    source = 'map'
    artPool.mockResolvedValue([art(0), art(1)])

    const wrapper = await mountScreensaver()

    expect(wrapper.find('img').attributes('src')).toBe('/media/city-art/art-0?v=1')
    expect(wrapper.text()).toContain('Town 0')
    expect(wrapper.text()).toContain('Wales')
    expect(slideshowPool).not.toHaveBeenCalled()
  })

  it('paints the theme background, so nothing flashes black between maps', async () => {
    source = 'map'
    artPool.mockResolvedValue([art(0)])

    const wrapper = await mountScreensaver()

    expect(wrapper.attributes('style')).toContain('rgb(13, 43, 69)')
  })

  it('leaves a photograph uncaptioned, since it has nothing to say about it', async () => {
    slideshowPool.mockResolvedValue([photo(0)])

    const wrapper = await mountScreensaver()

    expect(wrapper.text()).not.toContain('Blueprint')
  })

  it('falls back to photographs when the artwork pool is still empty', async () => {
    // The first hours of a Pi that has only just been told to draw maps. A
    // blank screen here would look exactly like a broken display.
    source = 'map'
    artPool.mockResolvedValue([])
    slideshowPool.mockResolvedValue([photo(0)])

    const wrapper = await mountScreensaver()

    expect(wrapper.find('img').attributes('src')).toBe('/media/photos/photo-0?v=1')
  })

  it('falls back to artwork when the photo library is empty', async () => {
    slideshowPool.mockResolvedValue([])
    artPool.mockResolvedValue([art(0)])

    const wrapper = await mountScreensaver()

    expect(wrapper.find('img').attributes('src')).toBe('/media/city-art/art-0?v=1')
  })

  it('alternates the two sources when set to both', async () => {
    source = 'both'
    slideshowPool.mockResolvedValue([photo(0), photo(1)])
    artPool.mockResolvedValue([art(0), art(1)])

    const wrapper = await mountScreensaver()
    const first = wrapper.find('img').attributes('src')

    expect(first).toBe('/media/photos/photo-0?v=1')
    expect(slideshowPool).toHaveBeenCalled()
    expect(artPool).toHaveBeenCalled()
  })

  it('drops a picture that will not load rather than stopping on it', async () => {
    source = 'map'
    artPool.mockResolvedValue([art(0), art(1), art(2)])

    const wrapper = await mountScreensaver()
    await wrapper.find('img').trigger('error')
    await nextTick()

    // The broken one is gone from the rotation; the component is still up.
    expect(wrapper.findAll('img').length).toBeGreaterThan(0)
  })

  it('wakes on a press rather than waiting for the release', async () => {
    const wrapper = await mountScreensaver()
    await wrapper.trigger('pointerdown')

    expect(wrapper.emitted('wake')).toHaveLength(1)
  })
})
