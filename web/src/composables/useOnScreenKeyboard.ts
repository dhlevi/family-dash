import { computed, onScopeDispose, ref, watch } from 'vue'
import { applyKey, type KeyAction } from '@/utils/keyboardInput'
import { useSettingsStore } from '@/stores/settings'

/**
 * The on-screen keyboard's brain: which field is being typed into, and what
 * a key press does to it.
 *
 * Attached once, at the app shell, and driven by `focusin` on the document
 * rather than by threading props through every input. That means it covers
 * fields it was never told about
 *
 * Chromium on Linux has no dependable touch keyboard of its own, and the
 * OS-level ones on Pi OS need configuring and are unreliable about appearing
 * on focus. Doing it in the app also means the layout can suit the field:
 * a stepper gets a number pad rather than a QWERTY nobody needs.
 */
export type KeyboardLayout = 'text' | 'numeric'

type Field = HTMLInputElement | HTMLTextAreaElement

/**
 * Input types worth typing into. Everything else either has a better native
 * control (a date picker beats spelling a date) or takes no text at all.
 */
const TEXTUAL_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''])

export function useOnScreenKeyboard() {
  const settings = useSettingsStore()

  const target = ref<Field | null>(null)
  const layout = ref<KeyboardLayout>('text')

  /**
   * Whether this device should get a keyboard.
   *
   * `auto` asks the browser whether the pointer is coarse, which is true for
   * a touchscreen and false for a mouse. That is per-device rather than
   * per-install, which matters because the setting lives in a database
   * shared with whatever laptop is being used to work on this.
   */
  const suitsThisDevice = ref(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  )

  const enabled = computed(() => {
    const preference = settings.onScreenKeyboard
    if (preference === 'never') return false
    if (preference === 'always') return true
    return suitsThisDevice.value
  })

  const visible = computed(() => enabled.value && target.value !== null)

  function layoutFor(field: Field): KeyboardLayout {
    if (field instanceof HTMLTextAreaElement) return 'text'
    // `inputmode` is the field's own statement of intent, and the number
    // steppers already set it.
    if (field.inputMode === 'numeric' || field.inputMode === 'decimal' || field.type === 'number') return 'numeric'
    return 'text'
  }

  function accepts(node: EventTarget | null): node is Field {
    if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly
    if (!(node instanceof HTMLInputElement)) return false
    if (node.disabled || node.readOnly) return false

    return TEXTUAL_TYPES.has(node.type)
  }

  function onFocusIn(event: FocusEvent): void {
    if (!enabled.value) return

    if (!accepts(event.target)) {
      // Focus moved to something that takes no typing, so the keyboard has
      // nothing to act on.
      target.value = null
      return
    }

    const field = event.target
    target.value = field
    layout.value = layoutFor(field)

    /**
     * A number field starts with its value selected, so the first digit
     * replaces it.
     *
     * Without this, tapping 4 then 5 on a field showing "30" gives "450"
     * for example.
     */
    if (layout.value === 'numeric') {
      try {
        field.select()
      } catch {
        // Not every input supports selection; nothing here depends on it.
      }
    }

    // Bring the field above the keyboard. The panel covers the lower part of
    // the screen, and a field hidden behind it is worse than no keyboard.
    requestAnimationFrame(() => scrollIntoView(field))
  }

  function onFocusOut(): void {
    // Keys prevent their own default so focus never leaves the field, which
    // means this only fires when the field is genuinely left or unmounted.
    target.value = null
  }

  function onKeyDown(event: KeyboardEvent): void {
    // A real keyboard is plugged in after all, or somebody wants out.
    if (event.key === 'Escape') dismiss()
  }

  function scrollIntoView(element: HTMLElement): void {
    // Guarded because this runs inside a requestAnimationFrame, where a
    // throw is unhandled and not every environment implements it.
    if (typeof element.scrollIntoView !== 'function') return

    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  /** Applies a key to the focused field and tells Vue about it. */
  function press(action: KeyAction): void {
    const field = target.value
    if (!field) return

    const { value, caret } = applyKey(
      {
        value: field.value,
        start: field.selectionStart ?? field.value.length,
        end: field.selectionEnd ?? field.value.length
      },
      action
    )

    field.value = value
    field.setSelectionRange(caret, caret)

    // What makes `v-model` notice. Without this the DOM would hold text the
    // component's state has never seen.
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /**
   * Sends Enter to the field, then closes.
   *
   * Several forms act on Enter so the Done key has to be a real Enter
   * rather than only a way of putting the keyboard away.
   */
  function submit(): void {
    const field = target.value
    if (!field) return

    if (field instanceof HTMLTextAreaElement) {
      press({ kind: 'insert', text: '\n' })
      return
    }

    for (const type of ['keydown', 'keyup'] as const) {
      field.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true }))
    }

    dismiss()
  }

  function dismiss(): void {
    target.value?.blur()
    target.value = null
  }

  // Capture, so a field inside something that stops focus events bubbling is
  // still seen.
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('keydown', onKeyDown, true)

  // Switching the setting to `never` while a field is focused should put the
  // keyboard away rather than leave it up until the field is left.
  watch(enabled, value => {
    if (!value) target.value = null
  })

  onScopeDispose(() => {
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    document.removeEventListener('keydown', onKeyDown, true)
  })

  return { visible, layout, press, submit, dismiss }
}
