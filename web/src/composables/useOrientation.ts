import { onScopeDispose, ref, computed } from 'vue'

/**
 * Tracks whether the screen is portrait or landscape.
 *
 * Layout is handled in CSS wherever possible (Tailwind's `portrait:` and
 * `landscape:` variants). This exists for the cases CSS cannot express —
 * choosing how many days of forecast to request, or how many dashboard
 * columns to lay out — since the 16" panel can be mounted either way and the
 * answer differs.
 */
const query = typeof window !== 'undefined' ? window.matchMedia('(orientation: portrait)') : null
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
