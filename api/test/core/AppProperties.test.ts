import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProperties } from '../../lib/core/AppProperties'

const PROPERTIES = `
# a comment
! also a comment

[server]
port=4321
cors.origins=http://one.local, http://two.local

[tasks]
enabled=false
calendar.sync.cron=*/15 * * * *

[weather]
latitude=49.2827
blank=
`

describe('AppProperties', () => {
  let file: string

  beforeEach(() => {
    AppProperties.reset()
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'family-dash-')), 'application.properties')
    fs.writeFileSync(file, PROPERTIES)
    delete process.env.PORT
    delete process.env.TASKS_ENABLED
  })

  afterEach(() => {
    AppProperties.reset()
    delete process.env.PORT
    delete process.env.TASKS_ENABLED
  })

  it('prefixes keys with their section', () => {
    AppProperties.initialize(file)

    expect(AppProperties.getString('server.port')).toBe('4321')
    expect(AppProperties.getString('tasks.calendar.sync.cron')).toBe('*/15 * * * *')
  })

  it('coerces numbers and booleans', () => {
    AppProperties.initialize(file)

    expect(AppProperties.getNumber('server.port', 3000)).toBe(4321)
    expect(AppProperties.getNumber('weather.latitude', 0)).toBeCloseTo(49.2827)
    expect(AppProperties.getBoolean('tasks.enabled', true)).toBe(false)
  })

  it('falls back when a key is missing or empty', () => {
    AppProperties.initialize(file)

    expect(AppProperties.getString('nothing.here', 'fallback')).toBe('fallback')
    expect(AppProperties.getString('weather.blank', 'fallback')).toBe('fallback')
    expect(AppProperties.getNumber('nothing.here', 7)).toBe(7)
  })

  it('splits comma separated lists', () => {
    AppProperties.initialize(file)

    expect(AppProperties.getList('server.cors.origins')).toEqual(['http://one.local', 'http://two.local'])
    expect(AppProperties.getList('nothing.here', ['*'])).toEqual(['*'])
  })

  it('lets the environment override the file', () => {
    process.env.PORT = '9999'
    process.env.TASKS_ENABLED = 'true'
    AppProperties.initialize(file)

    // Explicit mapping: server.port -> PORT
    expect(AppProperties.getNumber('server.port', 3000)).toBe(9999)
    // Generated mapping: tasks.enabled -> TASKS_ENABLED
    expect(AppProperties.getBoolean('tasks.enabled', false)).toBe(true)
  })

  it('survives a missing properties file', () => {
    AppProperties.initialize(path.join(os.tmpdir(), 'definitely-not-here.properties'))

    expect(AppProperties.source()).toBeNull()
    expect(AppProperties.getString('server.port', '3000')).toBe('3000')
  })

  it('keeps values containing an equals sign intact', () => {
    const withEquals = path.join(path.dirname(file), 'equals.properties')
    fs.writeFileSync(withEquals, '[feed]\nurl=https://example.com/rss?id=12&sort=desc\n')
    AppProperties.initialize(withEquals)

    expect(AppProperties.getString('feed.url')).toBe('https://example.com/rss?id=12&sort=desc')
  })
})
