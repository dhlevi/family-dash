import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QrCode from './QrCode.vue'

/**
 * The QR is the whole mechanism for getting the shopping list onto a phone,
 * and a code that renders but does not scan looks identical to one that
 * works. These check the properties a scanner actually depends on.
 */
describe('QrCode', () => {
  const url = 'http://192.168.1.50:8080/shopping'

  it('renders an svg carrying the encoded value as its label', () => {
    const wrapper = mount(QrCode, { props: { value: url } })

    expect(wrapper.get('svg').attributes('aria-label')).toContain(url)
  })

  it('draws the modules as a single path rather than hundreds of rects', () => {
    // A rect per module is a lot of DOM for a Raspberry Pi to lay out.
    const wrapper = mount(QrCode, { props: { value: url } })

    expect(wrapper.findAll('path')).toHaveLength(1)
    expect(wrapper.get('path').attributes('d')?.length).toBeGreaterThan(100)
  })

  it('includes the quiet zone the spec requires', () => {
    const wrapper = mount(QrCode, { props: { value: url, margin: 4 } })
    const [, , width] = (wrapper.get('svg').attributes('viewBox') ?? '').split(' ').map(Number)

    const noMargin = mount(QrCode, { props: { value: url, margin: 0 } })
    const [, , bare] = (noMargin.get('svg').attributes('viewBox') ?? '').split(' ').map(Number)

    // Four modules of quiet zone on each side.
    expect(width! - bare!).toBe(8)
  })

  it('stays black on white whatever the theme, because scanners need the contrast', () => {
    const wrapper = mount(QrCode, { props: { value: url } })

    expect(wrapper.get('rect').attributes('fill')).toBe('#ffffff')
    expect(wrapper.get('path').attributes('fill')).toBe('#000000')
  })

  it('grows the symbol for longer content rather than failing', () => {
    const short = mount(QrCode, { props: { value: 'http://a.b/c', margin: 0 } })
    const long = mount(QrCode, { props: { value: `${url}?${'x'.repeat(200)}`, margin: 0 } })

    const size = (wrapper: ReturnType<typeof mount>) =>
      Number((wrapper.get('svg').attributes('viewBox') ?? '').split(' ')[2])

    expect(size(long)).toBeGreaterThan(size(short))
  })

  it('re-encodes when the value changes', async () => {
    const wrapper = mount(QrCode, { props: { value: url } })
    const before = wrapper.get('path').attributes('d')

    await wrapper.setProps({ value: 'http://192.168.1.99:8080/shopping' })

    expect(wrapper.get('path').attributes('d')).not.toBe(before)
  })
})
