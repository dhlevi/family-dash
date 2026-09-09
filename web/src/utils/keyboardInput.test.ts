import { describe, expect, it } from 'vitest'
import { applyKey, type FieldState } from './keyboardInput'

/**
 * Text editing for the on-screen keyboard.
 *
 * The caret arithmetic is the sort of thing that is subtly wrong forever if
 * nobody checks it: a key that appends to the end of the field instead of at
 * the caret, or a backspace that eats half an emoji.
 */
const at = (value: string, start: number, end = start): FieldState => ({ value, start, end })

describe('applyKey — inserting', () => {
  it('inserts at the caret rather than at the end', () => {
    expect(applyKey(at('helo', 3), { kind: 'insert', text: 'l' })).toEqual({ value: 'hello', caret: 4 })
  })

  it('appends when the caret is at the end', () => {
    expect(applyKey(at('hell', 4), { kind: 'insert', text: 'o' })).toEqual({ value: 'hello', caret: 5 })
  })

  it('inserts into an empty field', () => {
    expect(applyKey(at('', 0), { kind: 'insert', text: 'S' })).toEqual({ value: 'S', caret: 1 })
  })

  it('replaces a selection', () => {
    expect(applyKey(at('cat food', 0, 3), { kind: 'insert', text: 'dog' })).toEqual({
      value: 'dog food',
      caret: 3
    })
  })

  it('handles a selection made by dragging backwards', () => {
    // The browser reports start > end in that case.
    expect(applyKey(at('cat food', 3, 0), { kind: 'insert', text: 'dog' })).toEqual({
      value: 'dog food',
      caret: 3
    })
  })

  it('inserts more than one character at a time', () => {
    // The symbol page has keys like '.com'.
    expect(applyKey(at('example', 7), { kind: 'insert', text: '.com' })).toEqual({
      value: 'example.com',
      caret: 11
    })
  })
})

describe('applyKey — backspace', () => {
  it('deletes the character before the caret', () => {
    expect(applyKey(at('hello', 5), { kind: 'backspace' })).toEqual({ value: 'hell', caret: 4 })
  })

  it('deletes from the middle, leaving the rest', () => {
    expect(applyKey(at('helllo', 4), { kind: 'backspace' })).toEqual({ value: 'hello', caret: 3 })
  })

  it('does nothing at the start of the field', () => {
    expect(applyKey(at('hello', 0), { kind: 'backspace' })).toEqual({ value: 'hello', caret: 0 })
  })

  it('does nothing to an empty field', () => {
    expect(applyKey(at('', 0), { kind: 'backspace' })).toEqual({ value: '', caret: 0 })
  })

  it('deletes a selection instead of one character', () => {
    expect(applyKey(at('cat food', 3, 8), { kind: 'backspace' })).toEqual({ value: 'cat', caret: 3 })
  })

  it('removes a whole emoji rather than half of one', () => {
    // '🎉' is a surrogate pair; taking one code unit leaves a broken glyph.
    expect(applyKey(at('party 🎉', 8), { kind: 'backspace' })).toEqual({ value: 'party ', caret: 6 })
  })

  it('leaves a combining accent to be removed on its own', () => {
    // What a hardware keyboard does: 'é' typed as e + combining acute loses
    // the accent first.
    const composed = 'café'
    expect(applyKey(at(composed, composed.length), { kind: 'backspace' })).toEqual({
      value: 'cafe',
      caret: 4
    })
  })
})

describe('applyKey — clear', () => {
  it('empties the field and puts the caret at the start', () => {
    expect(applyKey(at('a long note', 5), { kind: 'clear' })).toEqual({ value: '', caret: 0 })
  })
})

describe('applyKey — out-of-range positions', () => {
  it('copes with a caret past the end of the value', () => {
    // Can happen if the model changed under the keyboard between presses.
    expect(applyKey(at('hi', 99), { kind: 'insert', text: '!' })).toEqual({ value: 'hi!', caret: 3 })
    expect(applyKey(at('hi', 99), { kind: 'backspace' })).toEqual({ value: 'h', caret: 1 })
  })

  it('copes with a negative caret', () => {
    expect(applyKey(at('hi', -5), { kind: 'insert', text: '!' })).toEqual({ value: '!hi', caret: 1 })
  })
})
