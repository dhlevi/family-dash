import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * Reports when nobody has touched the display for a while.
 *
 * Only deliberate actions count as activity: a tap, a key, a scroll. Pointer
 * *movement* is left out on purpose — a wall display with a mouse plugged in
 * would otherwise be kept awake for weeks by a cursor sitting still under a
 * draught, and what the screensaver is for is the screen nobody is using.
 *
 * Listens in the capture phase on the window, so activity is seen even when
 * something below stops the event from bubbling.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function useIdle(minutes: Ref<number>): { idle: Ref<boolean>; wake: () => void } {
  const idle = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null

  function clear(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function schedule(): void {
    clear()
    // Zero means the screensaver is switched off, so nothing is ever idle.
    if (minutes.value <= 0) return

    timer = setTimeout(() => (idle.value = true), minutes.value * 60_000)
  }

  function wake(): void {
    idle.value = false
    schedule()
  }

  function onActivity(): void {
    if (idle.value) idle.value = false
    schedule()
  }

  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, onActivity, { capture: true, passive: true })
  }

  // A changed setting takes effect without a reload, and switching it off
  // wakes the screen rather than leaving it stuck on the slideshow.
  watch(
    minutes,
    value => {
      if (value <= 0) idle.value = false
      schedule()
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    clear()
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, onActivity, { capture: true })
    }
  })

  return { idle, wake }
}
