import { beforeAll, describe, expect, it } from 'vitest'
import { AppProperties } from '../../lib/core/AppProperties'
import { catalog, defaults, definitionFor, isKnownSetting, SETTINGS } from '../../lib/services/SettingsCatalog'

/**
 * The catalogue is the only thing standing between the Settings page and
 * arbitrary rows in the `setting` table, and it is what makes a fresh
 * install behave like a configured one.
 */
beforeAll(() => {
  // No properties file in the test environment; defaults fall back to the
  // literals in the catalogue.
  AppProperties.initialize('/definitely/not/here.properties')
})

describe('SettingsCatalog', () => {
  it('recognises known keys and rejects everything else', () => {
    expect(isKnownSetting('appearance.theme')).toBe(true)
    expect(isKnownSetting('weather.units')).toBe(true)

    expect(isKnownSetting('appearance.them')).toBe(false)
    expect(isKnownSetting('__proto__')).toBe(false)
    expect(isKnownSetting('constructor')).toBe(false)
  })

  it('provides a default for every declared setting', () => {
    const values = defaults()

    expect(Object.keys(values).sort()).toEqual(Object.keys(SETTINGS).sort())
    for (const [key, value] of Object.entries(values)) {
      expect(value, `${key} should have a non-undefined default`).not.toBeUndefined()
    }
  })

  it('has a default that satisfies its own schema, for every setting', () => {
    // A default that fails validation would make the Settings page unable to
    // save the value it was already showing.
    for (const [key, definition] of Object.entries(SETTINGS)) {
      const result = definition.schema.safeParse(definition.default())
      expect(result.success, `${key} default failed its schema`).toBe(true)
    }
  })

  it('describes every setting, since the descriptions are user-facing', () => {
    for (const entry of catalog()) {
      expect(entry.description.length, entry.key).toBeGreaterThan(10)
    }
  })

  describe('validation', () => {
    const parse = (key: string, value: unknown) => definitionFor(key)!.schema.safeParse(value).success

    it('constrains the theme to the supported values', () => {
      expect(parse('appearance.theme', 'dark')).toBe(true)
      expect(parse('appearance.theme', 'light')).toBe(true)
      expect(parse('appearance.theme', 'neon')).toBe(false)
      expect(parse('appearance.theme', null)).toBe(false)
    })

    it('requires a 6-digit hex accent colour', () => {
      expect(parse('appearance.accent', '#4f8ef7')).toBe(true)
      expect(parse('appearance.accent', '#FFF')).toBe(false)
      expect(parse('appearance.accent', 'rebeccapurple')).toBe(false)
    })

    it('bounds numeric settings', () => {
      expect(parse('news.maxArticles', 30)).toBe(true)
      expect(parse('news.maxArticles', 4)).toBe(false)
      expect(parse('news.maxArticles', 201)).toBe(false)
      expect(parse('news.maxArticles', 30.5)).toBe(false)

      expect(parse('photos.slideshowSeconds', 20)).toBe(true)
      expect(parse('photos.slideshowSeconds', 2)).toBe(false)
    })

    it('keeps latitude and longitude on the globe', () => {
      expect(parse('weather.latitude', 49.2827)).toBe(true)
      expect(parse('weather.latitude', 91)).toBe(false)
      expect(parse('weather.longitude', -123.12)).toBe(true)
      expect(parse('weather.longitude', 181)).toBe(false)
    })

    it('accepts only known dashboard widgets', () => {
      expect(parse('dashboard.widgets', ['calendar', 'tasks'])).toBe(true)
      expect(parse('dashboard.widgets', [])).toBe(true)
      expect(parse('dashboard.widgets', ['stocks'])).toBe(false)
      expect(parse('dashboard.widgets', 'calendar')).toBe(false)
    })

    it('allows only Sunday or Monday as the first day of the week', () => {
      expect(parse('calendar.weekStartsOn', 0)).toBe(true)
      expect(parse('calendar.weekStartsOn', 1)).toBe(true)
      expect(parse('calendar.weekStartsOn', 6)).toBe(false)
    })

    it('trims and bounds the assignee shortcut list', () => {
      expect(parse('tasks.assignees', ['Sam', 'Dylan'])).toBe(true)
      expect(parse('tasks.assignees', [''])).toBe(false)
      expect(parse('tasks.assignees', new Array(21).fill('x'))).toBe(false)
    })
  })

  it('reads location defaults from configuration when present', () => {
    AppProperties.reset()
    process.env.DEFAULT_LATITUDE = '51.5072'
    process.env.DEFAULT_LOCATION_NAME = 'London'
    AppProperties.initialize('/definitely/not/here.properties')

    try {
      expect(defaults()['weather.latitude']).toBeCloseTo(51.5072)
      expect(defaults()['weather.locationName']).toBe('London')
    } finally {
      delete process.env.DEFAULT_LATITUDE
      delete process.env.DEFAULT_LOCATION_NAME
      AppProperties.reset()
      AppProperties.initialize('/definitely/not/here.properties')
    }
  })
})
