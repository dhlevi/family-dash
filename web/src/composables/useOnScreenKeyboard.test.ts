import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOnScreenKeyboard } from './useOnScreenKeyboard'
import { useSettingsStore } from '@/stores/settings'
import type { AppSettings, KeyboardMode } from '@/api/types'

/**
 * Deciding which field is being typed into, and typing into it.
 *
 * The keyboard is attached once at the app shell and finds fields by
 * watching focus, so what it accepts is the whole of its configuration —
 * getting that wrong means either a keyboard over a date picker that has a
 * better native one, or no keyboard on the field somebody is standing in
 * front of.
 */
let scope: ReturnType<typeof effectScope>

function start(mode: KeyboardMode = 'always') {
  setActivePinia(createPinia())

  const settings = useSettingsStore()
  settings.values = { 'input.onScreenKeyboard': mode } as AppSettings

  scope = effectScope()
  return { keyboard: scope.run(() => useOnScreenKeyboard())!, settings }
}

/** Adds a field to the document and focuses it, as a tap would. */
function field(
  tag: 'input' | 'textarea',
  attributes: Record<string, string> = {},
  value = ''
): HTMLInputElement | HTMLTextAreaElement {
  const element = document.createElement(tag)
  for (const [name, attribute] of Object.entries(attributes)) element.setAttribute(name, attribute)
  element.value = value
  document.body.append(element)

  // jsdom dispatches focus events from .focus() without needing window focus.
  element.focus()
  return element as HTMLInputElement | HTMLTextAreaElement
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  scope?.stop()
  document.body.innerHTML = ''
})

describe('which fields get a keyboard', () => {
  it('appears for the text fields somebody types into', async () => {
    const { keyboard } = start()

    for (const type of ['text', 'search', 'url', 'email', 'tel']) {
      field('input', { type })
      await nextTick()
      expect(keyboard.visible.value, type).toBe(true)
    }
  })

  it('appears for a textarea', async () => {
    const { keyboard } = start()

    field('textarea')
    await nextTick()

    expect(keyboard.visible.value).toBe(true)
  })

  it('appears for an input with no type at all', async () => {
    const { keyboard } = start()

    // The recipe editor's ingredient rows are plain inputs.
    field('input')
    await nextTick()

    expect(keyboard.visible.value).toBe(true)
  })

  it('stays away from controls that take no typing', async () => {
    const { keyboard } = start()

    for (const type of ['checkbox', 'radio', 'file', 'color', 'range', 'button', 'submit']) {
      field('input', { type })
      await nextTick()
      expect(keyboard.visible.value, type).toBe(false)
    }
  })

  it('stays away from the date and time fields, which have better native pickers', async () => {
    const { keyboard } = start()

    for (const type of ['date', 'time', 'datetime-local', 'month', 'week']) {
      field('input', { type })
      await nextTick()
      // Chromium's own calendar is tappable and beats spelling a date out.
      expect(keyboard.visible.value, type).toBe(false)
    }
  })

  it('stays away from a field that cannot be edited', async () => {
    const { keyboard } = start()

    field('input', { type: 'text', disabled: '' })
    await nextTick()
    expect(keyboard.visible.value).toBe(false)

    field('input', { type: 'text', readonly: '' })
    await nextTick()
    expect(keyboard.visible.value).toBe(false)
  })

  it('goes away when the field is left', async () => {
    const { keyboard } = start()

    const input = field('input', { type: 'text' })
    await nextTick()
    expect(keyboard.visible.value).toBe(true)

    input.blur()
    await nextTick()
    expect(keyboard.visible.value).toBe(false)
  })
})

describe('when the keyboard is switched off', () => {
  it('never appears on "never"', async () => {
    const { keyboard } = start('never')

    field('input', { type: 'text' })
    await nextTick()

    expect(keyboard.visible.value).toBe(false)
  })

  it('follows the device on "auto"', async () => {
    // jsdom reports no coarse pointer, which stands in for a machine with a
    // mouse — where the setting's whole point is to stay out of the way.
    const { keyboard } = start('auto')

    field('input', { type: 'text' })
    await nextTick()

    expect(keyboard.visible.value).toBe(false)
  })

  it('puts itself away if the setting changes while a field is focused', async () => {
    const { keyboard, settings } = start('always')

    field('input', { type: 'text' })
    await nextTick()
    expect(keyboard.visible.value).toBe(true)

    settings.values = { 'input.onScreenKeyboard': 'never' } as AppSettings
    await nextTick()

    expect(keyboard.visible.value).toBe(false)
  })
})

describe('which layout a field gets', () => {
  it('gives a number field a keypad', async () => {
    const { keyboard } = start()

    field('input', { type: 'text', inputmode: 'numeric' })
    await nextTick()

    expect(keyboard.layout.value).toBe('numeric')
  })

  it('recognises a decimal field too', async () => {
    const { keyboard } = start()

    field('input', { type: 'text', inputmode: 'decimal' })
    await nextTick()

    expect(keyboard.layout.value).toBe('numeric')
  })

  it('gives everything else letters', async () => {
    const { keyboard } = start()

    field('input', { type: 'text' })
    await nextTick()
    expect(keyboard.layout.value).toBe('text')

    field('textarea')
    await nextTick()
    expect(keyboard.layout.value).toBe('text')
  })

  it('selects a number field so the first digit replaces it', async () => {
    const { keyboard } = start()

    const input = field('input', { type: 'text', inputmode: 'numeric' }, '30') as HTMLInputElement
    await nextTick()

    expect(keyboard.layout.value).toBe('numeric')
    // Otherwise typing 4 then 5 on a field showing "30" gives something
    // like "450", because the steppers re-render and clamp as you type.
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2])
  })
})

describe('typing into the field', () => {
  it('inserts at the caret and tells Vue about it', async () => {
    const { keyboard } = start()

    const input = field('input', { type: 'text' }, 'helo') as HTMLInputElement
    input.setSelectionRange(3, 3)
    await nextTick()

    let inputEvents = 0
    input.addEventListener('input', () => inputEvents++)

    keyboard.press({ kind: 'insert', text: 'l' })

    expect(input.value).toBe('hello')
    expect(input.selectionStart).toBe(4)
    // Without the event, the DOM would hold text the component never saw.
    expect(inputEvents).toBe(1)
  })

  it('deletes backwards', async () => {
    const { keyboard } = start()

    const input = field('input', { type: 'text' }, 'hello') as HTMLInputElement
    input.setSelectionRange(5, 5)
    await nextTick()

    keyboard.press({ kind: 'backspace' })

    expect(input.value).toBe('hell')
  })

  it('does nothing when no field is focused', () => {
    const { keyboard } = start()

    // Nothing to throw at, and nothing to throw.
    expect(() => keyboard.press({ kind: 'insert', text: 'x' })).not.toThrow()
  })
})

describe('finishing with a field', () => {
  it('sends a real Enter, because forms act on it', async () => {
    const { keyboard } = start()

    const input = field('input', { type: 'text' }, 'Feed the cat') as HTMLInputElement
    await nextTick()

    const keys: string[] = []
    input.addEventListener('keyup', event => keys.push(event.key))

    keyboard.submit()

    // The task quick-add and the tag field both add on Enter.
    expect(keys).toEqual(['Enter'])
  })

  it('closes after submitting a single-line field', async () => {
    const { keyboard } = start()

    field('input', { type: 'text' })
    await nextTick()

    keyboard.submit()
    await nextTick()

    expect(keyboard.visible.value).toBe(false)
  })

  it('adds a newline in a textarea instead of closing it', async () => {
    const { keyboard } = start()

    const area = field('textarea', {}, 'first line') as HTMLTextAreaElement
    area.setSelectionRange(10, 10)
    await nextTick()

    keyboard.submit()
    await nextTick()

    expect(area.value).toBe('first line\n')
    // A note being written over several lines should not be cut off by the
    // key that starts the next one.
    expect(keyboard.visible.value).toBe(true)
  })

  it('closes and lets go of the field when dismissed', async () => {
    const { keyboard } = start()

    const input = field('input', { type: 'text' })
    await nextTick()

    keyboard.dismiss()
    await nextTick()

    expect(keyboard.visible.value).toBe(false)
    expect(document.activeElement).not.toBe(input)
  })

  it('closes on Escape, for when a real keyboard turns up after all', async () => {
    const { keyboard } = start()

    field('input', { type: 'text' })
    await nextTick()
    expect(keyboard.visible.value).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(keyboard.visible.value).toBe(false)
  })
})
