import { onScopeDispose, readonly, ref } from 'vue'

/**
 * A shared ticking clock.
 *
 * One interval for the whole app rather than one per component: this display
 * is on for weeks at a time, and a dozen independent timers is a dozen
 * chances to leak one.
 */
const now = ref(new Date())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | undefined

function start(): void {
  if (timer) return
  // Ticking on the second boundary rather than every 1000ms from mount stops
  // the clock from visibly lagging behind the wall clock.
  const alignToSecond = 1000 - (Date.now() % 1000)
  setTimeout(() => {
    now.value = new Date()
    timer = setInterval(() => {
      now.value = new Date()
    }, 1000)
  }, alignToSecond)
}

function stop(): void {
  if (!timer) return
  clearInterval(timer)
  timer = undefined
}

export function useClock() {
  subscribers++
  start()

  onScopeDispose(() => {
    subscribers--
    if (subscribers <= 0) stop()
  })

  return readonly(now)
}
