import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WeatherIcon from './WeatherIcon.vue'

/**
 * The icon is composed from shared parts, so what is worth testing is which
 * parts appear for which condition — and that the night moon's mask id is
 * unique, because a shared id would silently make every moon on the page
 * take the first one's shape.
 */
const mountIcon = (code: number, isDay = true) => mount(WeatherIcon, { props: { code, isDay } })

const hasMoon = (wrapper: ReturnType<typeof mountIcon>) => wrapper.find('circle[mask]').exists()
const hasCloud = (wrapper: ReturnType<typeof mountIcon>) =>
  wrapper.findAll('path').some(path => (path.attributes('d') ?? '').startsWith('M20 44'))

describe('WeatherIcon composition', () => {
  it('draws a sun for a clear day and a moon for a clear night', () => {
    const day = mountIcon(0, true)
    const night = mountIcon(0, false)

    expect(hasMoon(day)).toBe(false)
    expect(hasMoon(night)).toBe(true)
    // A clear sky has no cloud in it, day or night.
    expect(hasCloud(day)).toBe(false)
    expect(hasCloud(night)).toBe(false)
  })

  it('draws both a disc and a cloud when partly cloudy', () => {
    const wrapper = mountIcon(2, false)

    expect(hasMoon(wrapper)).toBe(true)
    expect(hasCloud(wrapper)).toBe(true)
  })

  it('draws a cloud with no disc when overcast', () => {
    const wrapper = mountIcon(3, true)

    expect(hasMoon(wrapper)).toBe(false)
    expect(hasCloud(wrapper)).toBe(true)
  })

  it('labels itself with the condition, for screen readers and tooltips', () => {
    expect(mountIcon(63).get('svg').attributes('aria-label')).toBe('Rain')
    expect(mountIcon(95).get('svg').attributes('aria-label')).toBe('Thunderstorm')
    expect(mountIcon(45).get('svg').attributes('aria-label')).toBe('Fog')
  })

  it('falls back to an unsettled cloud for an unknown code', () => {
    const wrapper = mountIcon(4321)

    expect(wrapper.get('svg').attributes('aria-label')).toBe('Unsettled')
    expect(hasCloud(wrapper)).toBe(true)
    expect(hasMoon(wrapper)).toBe(false)
  })

  it('renders at the requested size', () => {
    const svg = mountIcon(0).get('svg')

    expect(svg.attributes('width')).toBe('48')

    const large = mount(WeatherIcon, { props: { code: 0, size: 96 } }).get('svg')
    expect(large.attributes('width')).toBe('96')
  })

  it('gives the night moon a mask and points it at that mask', () => {
    // `useId` numbers ids per app instance, and every `mount` here creates
    // its own app — so cross-instance uniqueness cannot be shown in jsdom.
    // What is checkable is that the reference is wired to the id it renders;
    // uniqueness within one real app was confirmed in the browser (twelve
    // night icons, twelve distinct ids).
    const wrapper = mountIcon(0, false)
    const maskId = wrapper.get('mask').attributes('id')

    expect(maskId).toBeTruthy()
    expect(wrapper.get('circle[mask]').attributes('mask')).toBe(`url(#${maskId})`)
  })

  it('draws precipitation only for wet conditions', () => {
    // The rain colour is set on the group, not on each path.
    const hasRain = (code: number) =>
      mount(WeatherIcon, { props: { code } })
        .findAll('g')
        .some(group => (group.attributes('stroke') ?? '') === '#5aa9e6')

    expect(hasRain(63)).toBe(true)
    expect(hasRain(81)).toBe(true)
    expect(hasRain(53)).toBe(true)
    expect(hasRain(0)).toBe(false)
    expect(hasRain(3)).toBe(false)
  })

  it('draws snow rather than rain for snowfall', () => {
    const strokeColours = (code: number) =>
      mount(WeatherIcon, { props: { code } })
        .findAll('g')
        .map(group => group.attributes('stroke'))

    expect(strokeColours(73)).toContain('#cfe8f5')
    expect(strokeColours(73)).not.toContain('#5aa9e6')
  })
})
