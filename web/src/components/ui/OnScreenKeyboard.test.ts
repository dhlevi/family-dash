import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OnScreenKeyboard from './OnScreenKeyboard.vue'
import type { KeyAction } from '@/utils/keyboardInput'

/**
 * The keys.
 *
 * The behaviour that matters most is the one that is invisible: every key
 * has to prevent its own default, or the first tap blurs the field and there
 * is nothing left to type into. After that it is shift semantics, which are
 * one-shot on purpose.
 */
function mountKeyboard(layout: 'text' | 'numeric' = 'text') {
  return mount(OnScreenKeyboard, { props: { layout } })
}

type Keyboard = ReturnType<typeof mountKeyboard>

const keys = (wrapper: Keyboard) => wrapper.findAll('button')

function key(wrapper: Keyboard, label: string) {
  const found = keys(wrapper).find(
    button => button.text().trim() === label || button.attributes('aria-label') === label
  )
  if (!found) throw new Error(`no key labelled '${label}'`)
  return found
}

/** Presses a key the way a finger does. */
async function tap(wrapper: Keyboard, label: string) {
  await key(wrapper, label).trigger('pointerdown')
}

const pressed = (wrapper: Keyboard): KeyAction[] => ((wrapper.emitted('press') ?? []) as KeyAction[][]).flat()

describe('OnScreenKeyboard — keeping the field focused', () => {
  it('prevents the default on every key', async () => {
    const wrapper = mountKeyboard()

    // pointerdown moves focus unless the default is prevented, and a
    // keyboard that blurs the field it is typing into is useless.
    for (const button of keys(wrapper)) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true })
      button.element.dispatchEvent(event)
      expect(event.defaultPrevented, button.text() || button.attributes('aria-label')).toBe(true)
    }
  })

  it('prevents the default on the gaps between keys too', () => {
    const wrapper = mountKeyboard()

    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    wrapper.get('[aria-label="On-screen keyboard"]').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('OnScreenKeyboard — letters', () => {
  it('offers a QWERTY layout', async () => {
    const wrapper = mountKeyboard()

    for (const letter of ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'm']) {
      expect(key(wrapper, letter).exists(), letter).toBe(true)
    }
  })

  it('sends the letter that was tapped', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'h')
    await tap(wrapper, 'i')

    expect(pressed(wrapper)).toEqual([
      { kind: 'insert', text: 'h' },
      { kind: 'insert', text: 'i' }
    ])
  })

  it('capitalises one letter after shift, then releases', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Shift')
    // Tapped by its shown label, which is what a finger goes for.
    await tap(wrapper, 'S')
    await tap(wrapper, 'a')
    await tap(wrapper, 'm')

    // What shift is nearly always for: the first letter of a name.
    expect(pressed(wrapper).map(action => (action.kind === 'insert' ? action.text : action.kind))).toEqual([
      'S',
      'a',
      'm'
    ])
  })

  it('shows the keys in the case they will produce', async () => {
    const wrapper = mountKeyboard()

    expect(key(wrapper, 'q').exists()).toBe(true)

    await tap(wrapper, 'Shift')
    expect(key(wrapper, 'Q').exists()).toBe(true)
  })

  it('can be shifted and unshifted without typing anything', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Shift')
    await tap(wrapper, 'Shift')
    await tap(wrapper, 'a')

    expect(pressed(wrapper)).toEqual([{ kind: 'insert', text: 'a' }])
  })

  it('types a space', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Space')

    expect(pressed(wrapper)).toEqual([{ kind: 'insert', text: ' ' }])
  })

  it('asks for a backspace rather than sending a character', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Backspace')

    expect(pressed(wrapper)).toEqual([{ kind: 'backspace' }])
  })
})

describe('OnScreenKeyboard — symbols', () => {
  it('swaps to digits and punctuation, and back', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, '?123')
    expect(key(wrapper, '1').exists()).toBe(true)
    expect(key(wrapper, '@').exists()).toBe(true)

    await tap(wrapper, 'ABC')
    expect(key(wrapper, 'q').exists()).toBe(true)
  })

  it('types a digit from the symbol page', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, '?123')
    await tap(wrapper, '7')

    expect(pressed(wrapper)).toEqual([{ kind: 'insert', text: '7' }])
  })

  it('offers the second rank of symbols without a third page', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, '?123')

    // Two taps to reach a '%' is enough; a third page is not.
    for (const symbol of ['+', '=', '#', '%', '_']) {
      expect(key(wrapper, symbol).exists(), symbol).toBe(true)
    }
  })

  it('does not capitalise a symbol when shift was left on', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Shift')
    await tap(wrapper, '?123')
    await tap(wrapper, '1')

    expect(pressed(wrapper)).toEqual([{ kind: 'insert', text: '1' }])
  })
})

describe('OnScreenKeyboard — numbers', () => {
  it('offers a keypad rather than a QWERTY', () => {
    const wrapper = mountKeyboard('numeric')

    for (const digit of ['1', '5', '9', '0', '.', '-']) {
      expect(key(wrapper, digit).exists(), digit).toBe(true)
    }
    // Nobody needs letters to type "30".
    expect(keys(wrapper).some(button => button.text().trim() === 'q')).toBe(false)
    expect(keys(wrapper).some(button => button.text().trim() === 'space')).toBe(false)
  })

  it('types digits, and can delete them', async () => {
    const wrapper = mountKeyboard('numeric')

    await tap(wrapper, '4')
    await tap(wrapper, '5')
    await tap(wrapper, 'Backspace')

    expect(pressed(wrapper)).toEqual([
      { kind: 'insert', text: '4' },
      { kind: 'insert', text: '5' },
      { kind: 'backspace' }
    ])
  })
})

describe('OnScreenKeyboard — finishing', () => {
  it('reports Done separately from a key press', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Done')

    expect(wrapper.emitted('submit')).toHaveLength(1)
    expect(pressed(wrapper)).toEqual([])
  })

  it('offers a way out that does not submit anything', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, 'Hide the keyboard')

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('starts on letters and unshifted when it moves to another field', async () => {
    const wrapper = mountKeyboard()

    await tap(wrapper, '?123')
    await tap(wrapper, 'ABC')
    await tap(wrapper, 'Shift')

    // Changing layout is what happens when focus moves to another field; it
    // should not arrive still showing symbols or still shifted.
    await wrapper.setProps({ layout: 'numeric' })
    await wrapper.setProps({ layout: 'text' })

    expect(key(wrapper, 'q').exists()).toBe(true)
    await tap(wrapper, 'a')
    expect(pressed(wrapper).at(-1)).toEqual({ kind: 'insert', text: 'a' })
  })
})
