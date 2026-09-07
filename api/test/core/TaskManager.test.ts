import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskManager } from '../../lib/core/TaskManager'
import { Task } from '../../lib/core/model/Task'

function task(overrides: Partial<Task> & { name: string }): Task {
  return {
    cron: '*/5 * * * *',
    enabled: true,
    execute: async () => {},
    ...overrides
  }
}

describe('TaskManager', () => {
  beforeEach(() => TaskManager.reset())
  afterEach(() => TaskManager.reset())

  it('records a successful run', async () => {
    let runs = 0
    TaskManager.register(
      task({
        name: 'counter',
        execute: async () => {
          runs++
        }
      })
    )

    const status = await TaskManager.run('counter')

    expect(runs).toBe(1)
    expect(status).toMatchObject({ name: 'counter', runCount: 1, errorCount: 0, lastError: null, running: false })
    expect(status?.lastRunAt).not.toBeNull()
  })

  it('captures a failure without throwing, so one bad feed cannot stop the scheduler', async () => {
    TaskManager.register(
      task({
        name: 'broken',
        execute: async () => {
          throw new Error('feed returned 500')
        }
      })
    )

    const status = await TaskManager.run('broken')

    expect(status).toMatchObject({ errorCount: 1, runCount: 0, lastError: 'feed returned 500' })
  })

  it('reports null for an unknown task instead of throwing', async () => {
    await expect(TaskManager.run('nope')).resolves.toBeNull()
  })

  it('skips a trigger while the previous run is still going', async () => {
    let started = 0
    let release: (() => void) | undefined

    TaskManager.register(
      task({
        name: 'slow',
        execute: async () => {
          started++
          await new Promise<void>(resolve => {
            release = resolve
          })
        }
      })
    )

    const first = TaskManager.run('slow')
    // Let the first run reach its await before triggering again.
    await new Promise(resolve => setImmediate(resolve))

    await TaskManager.run('slow')
    expect(started).toBe(1)

    release?.()
    await first
    expect(started).toBe(1)
  })

  it('does not schedule a task with an invalid cron expression', async () => {
    TaskManager.register(task({ name: 'malformed', cron: 'not a cron' }))

    await TaskManager.start()

    expect(TaskManager.status()[0]?.lastError).toMatch(/Invalid cron/)
  })

  it('ignores a duplicate registration', () => {
    TaskManager.register(task({ name: 'once' }))
    TaskManager.register(task({ name: 'once' }))

    expect(TaskManager.names()).toEqual(['once'])
  })

  it('runs startup tasks when started', async () => {
    let ran = false
    TaskManager.register(
      task({
        name: 'startup',
        runOnStartup: true,
        execute: async () => {
          ran = true
        }
      })
    )

    await TaskManager.start()

    expect(ran).toBe(true)
  })

  it('does not run or schedule a disabled task', async () => {
    let ran = false
    TaskManager.register(
      task({
        name: 'off',
        enabled: false,
        runOnStartup: true,
        execute: async () => {
          ran = true
        }
      })
    )

    await TaskManager.start()

    expect(ran).toBe(false)
  })
})
