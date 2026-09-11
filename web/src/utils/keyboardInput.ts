/**
 * The text editing behind the on-screen keyboard.
 *
 * Kept apart from the DOM so the fiddly parts like where the caret ends up, what
 * a selection replaces, what backspace does to an emoji, can be tested
 * without a browser.
 */

export type KeyAction = { kind: 'insert'; text: string } | { kind: 'backspace' } | { kind: 'clear' }

/** A field as the browser reports it. */
export interface FieldState {
  value: string
  /** Caret position, or the start of the selection. */
  start: number
  /** Equal to `start` when nothing is selected. */
  end: number
}

export interface FieldEdit {
  value: string
  /** Where the caret should be afterwards. */
  caret: number
}

/**
 * How many code units to remove for one backspace.
 *
 * A character outside the basic set is stored as a surrogate pair,
 * and deleting a single code unit would leave half of one behind
 * and render as a replacement glyph. Combining marks are left
 * alone: removing the accent from a letter one press at a time is
 * what a hardware keyboard does too.
 */
function charactersBefore(value: string, caret: number): number {
  if (caret <= 0) return 0

  const previous = value.charCodeAt(caret - 1)
  const isLowSurrogate = previous >= 0xdc00 && previous <= 0xdfff

  if (isLowSurrogate && caret >= 2) {
    const before = value.charCodeAt(caret - 2)
    if (before >= 0xd800 && before <= 0xdbff) return 2
  }

  return 1
}

/** Applies one key press to a field, returning the new value and caret. */
export function applyKey(state: FieldState, action: KeyAction): FieldEdit {
  // Both ends are clamped into the value before being ordered: the browser
  // reports them the other way round for a selection dragged backwards, and
  // a caret can be stale if the model changed between presses.
  const length = state.value.length
  const first = Math.min(Math.max(state.start, 0), length)
  const second = Math.min(Math.max(state.end, 0), length)

  const start = Math.min(first, second)
  const end = Math.max(first, second)

  const before = state.value.slice(0, start)
  const after = state.value.slice(end)

  switch (action.kind) {
    case 'insert':
      return { value: before + action.text + after, caret: start + action.text.length }

    case 'backspace': {
      // A selection is what gets deleted, rather than the character before it.
      if (end > start) return { value: before + after, caret: start }

      const removed = charactersBefore(state.value, start)
      return { value: state.value.slice(0, start - removed) + after, caret: start - removed }
    }

    case 'clear':
      return { value: '', caret: 0 }
  }
}
