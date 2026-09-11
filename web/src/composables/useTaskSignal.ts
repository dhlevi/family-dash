import { onScopeDispose, ref, watch } from 'vue'

/**
 * A nudge between the widgets that can complete a task.
 *
 * The dashboard deliberately gives every widget its own data, so that a slow
 * feed cannot hold up the rest. That is right until two of them show the same
 * thing: with both the task list and the per-person strip on screen, ticking a
 * chore in one left it sitting there in the other until something forced a
 * reload, which reads as the tap not having worked.
 *
 * A widget never hears its own announcement. It has already updated itself
 * optimistically, and refetching would throw that away and flicker.
 */
const signal = ref({ count: 0, origin: 0 })

let nextOrigin = 1

export interface TaskSignal {
  /** Say that a task was completed, created or deleted. */
  announce: () => void
  /** Run `reload` when *another* widget changes a task. */
  onChanged: (reload: () => void) => void
}

export function useTaskSignal(): TaskSignal {
  const origin = nextOrigin++

  return {
    announce: () => {
      signal.value = { count: signal.value.count + 1, origin }
    },
    onChanged: reload => {
      const stop = watch(signal, value => {
        if (value.origin !== origin) reload()
      })

      onScopeDispose(stop)
    }
  }
}
