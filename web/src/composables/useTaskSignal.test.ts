import { effectScope, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTaskSignal } from './useTaskSignal'

describe('useTaskSignal', () => {
  it('tells the other widget to look again', async () => {
    const scope = effectScope()
    const reload = vi.fn()

    scope.run(() => {
      useTaskSignal().onChanged(reload)
      useTaskSignal().announce()
    })
    await nextTick()

    expect(reload).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('does not tell the widget that made the change', async () => {
    // It has already updated itself; refetching would discard that and flicker.
    const scope = effectScope()
    const reload = vi.fn()

    scope.run(() => {
      const signal = useTaskSignal()
      signal.onChanged(reload)
      signal.announce()
    })
    await nextTick()

    expect(reload).not.toHaveBeenCalled()
    scope.stop()
  })

  it('reaches every other listener', async () => {
    const scope = effectScope()
    const first = vi.fn()
    const second = vi.fn()

    scope.run(() => {
      useTaskSignal().onChanged(first)
      useTaskSignal().onChanged(second)
      useTaskSignal().announce()
    })
    await nextTick()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('stops listening once the widget has gone', async () => {
    const scope = effectScope()
    const reload = vi.fn()

    scope.run(() => useTaskSignal().onChanged(reload))
    scope.stop()

    const outside = effectScope()
    outside.run(() => useTaskSignal().announce())
    await nextTick()

    expect(reload).not.toHaveBeenCalled()
    outside.stop()
  })

  it('does nothing until something actually changes', async () => {
    const scope = effectScope()
    const reload = vi.fn()

    scope.run(() => useTaskSignal().onChanged(reload))
    await nextTick()

    expect(reload).not.toHaveBeenCalled()
    scope.stop()
  })
})
