import { onScopeDispose, ref, computed } from 'vue'

/**
 * Tracks whether the screen is portrait or landscape.
 *
 * Layout is handled in CSS wherever possible (Tailwind's `portrait:` and
 * `landscape:` variants). This exists for the cases CSS cannot express.
 */

/**
 * Guarded on `matchMedia` itself, not just on `window`: jsdom does not
 * implement it, and neither do some embedded browsers. Without a media query
 * the app simply renders its landscape layout rather than failing to mount.
 */
const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(orientation: portrait)')
    : null
const isPortrait = ref(query?.matches ?? false)

function onChange(event: MediaQueryListEvent): void {
  isPortrait.value = event.matches
}

let subscribers = 0

export function useOrientation() {
  if (query) {
    subscribers++
    if (subscribers === 1) query.addEventListener('change', onChange)

    onScopeDispose(() => {
      subscribers--
      if (subscribers <= 0) query.removeEventListener('change', onChange)
    })
  }

  return {
    isPortrait,
    isLandscape: computed(() => !isPortrait.value)
  }
}
