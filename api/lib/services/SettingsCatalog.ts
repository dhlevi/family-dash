import { z } from 'zod'
import { AppProperties } from '../core/AppProperties'

/**
 * The catalogue of application preferences.
 *
 * Every setting the UI can write is declared here with a schema and a
 * default. That gives three things at once: writes are validated, a fresh
 * install answers with sensible values for keys nobody has set yet, and an
 * unknown key is rejected rather than accumulating typo'd rows in the
 * `setting` table forever.
 *
 * Defaults for location come from the environment (`DEFAULT_LATITUDE` and
 * friends in `.env`), so a new install already points at the right place
 * before anyone opens Settings.
 */

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour such as #4f8ef7')

export const DASHBOARD_WIDGETS = ['calendar', 'tasks', 'weather', 'meal', 'notes', 'news', 'photos'] as const
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number]

interface SettingDefinition {
  schema: z.ZodType
  /** Evaluated lazily so environment-derived defaults are read at call time. */
  default: () => unknown
  description: string
}

export const SETTINGS: Record<string, SettingDefinition> = {
  // --- appearance ---------------------------------------------------------
  'appearance.theme': {
    schema: z.enum(['dark', 'light', 'auto']),
    default: () => 'dark',
    description:
      'Colour theme. Dark suits a wall display in a dim room; auto follows sunrise and sunset ' +
      'at the location set for the weather.'
  },
  'appearance.autoThemeOffsetMinutes': {
    schema: z.number().int().min(0).max(180),
    default: () => 30,
    description:
      'With the auto theme, how long after sunrise to wait before going light, and how long ' +
      'before sunset to go dark again. Sunrise itself is an unkind moment for a screen in a dim ' +
      'kitchen to turn white.'
  },
  'appearance.accent': {
    schema: hexColour,
    default: () => '#4f8ef7',
    description: 'Accent colour used for highlights and the active tab.'
  },
  'appearance.clock24Hour': {
    schema: z.boolean(),
    default: () => true,
    description: 'Show the header clock as 24-hour rather than am/pm.'
  },
  'appearance.screensaverMinutes': {
    schema: z.number().int().min(0).max(240),
    default: () => 0,
    description:
      'Idle minutes before the screen turns into a photo slideshow. Any tap or key dismisses it. ' + '0 disables it.'
  },

  // --- dashboard ----------------------------------------------------------
  'dashboard.widgets': {
    schema: z.array(z.enum(DASHBOARD_WIDGETS)),
    default: () => [...DASHBOARD_WIDGETS],
    description: 'Which dashboard widgets to show, in order.'
  },

  // --- calendar -----------------------------------------------------------
  'calendar.defaultView': {
    schema: z.enum(['month', 'week', 'agenda']),
    default: () => 'month',
    description: 'View the Calendar page opens on.'
  },
  'calendar.weekStartsOn': {
    // 0 = Sunday, 1 = Monday.
    schema: z.union([z.literal(0), z.literal(1)]),
    default: () => 0,
    description: 'First day of the week: 0 for Sunday, 1 for Monday.'
  },
  'calendar.dashboardDays': {
    schema: z.number().int().min(1).max(31),
    default: () => 7,
    description: 'How many days ahead the dashboard "Up next" widget looks.'
  },

  // --- tasks --------------------------------------------------------------
  'tasks.showCompleted': {
    schema: z.boolean(),
    default: () => false,
    description: 'Include completed tasks in the Tasks list by default.'
  },
  'tasks.assignees': {
    schema: z.array(z.string().trim().min(1).max(40)).max(20),
    default: () => [],
    description: 'Suggested names for task assignment. Free text, so this is only a shortcut.'
  },

  // --- network ------------------------------------------------------------
  'network.lanAddress': {
    // Empty, or an http(s) origin with no trailing path.
    schema: z
      .string()
      .trim()
      .refine(
        value => value === '' || /^https?:\/\/[^/\s]+$/.test(value),
        'Must be an address like http://192.168.1.50:8080, with no trailing path'
      ),
    default: () => '',
    description:
      'How this dashboard is reached from other devices on your network. Needed only when the ' +
      'kiosk itself browses to localhost, which cannot be shared with a phone.'
  },

  // --- meals --------------------------------------------------------------
  'meals.slots': {
    schema: z.array(z.enum(['breakfast', 'lunch', 'dinner', 'snack'])).min(1),
    default: () => ['breakfast', 'lunch', 'dinner'],
    description: 'Which meals the weekly planner has a row for.'
  },
  'meals.weekStartsOn': {
    schema: z.union([z.literal(0), z.literal(1)]),
    default: () => 1,
    description: 'First day of the planning week: 0 for Sunday, 1 for Monday.'
  },

  // --- weather ------------------------------------------------------------
  'weather.units': {
    schema: z.enum(['metric', 'imperial']),
    default: () => (AppProperties.getString('weather.units', 'metric') === 'imperial' ? 'imperial' : 'metric'),
    description: 'Temperature and wind units.'
  },
  'weather.latitude': {
    schema: z.number().min(-90).max(90),
    default: () => AppProperties.getNumber('weather.latitude', 49.2827),
    description: 'Latitude used for the forecast.'
  },
  'weather.longitude': {
    schema: z.number().min(-180).max(180),
    default: () => AppProperties.getNumber('weather.longitude', -123.1207),
    description: 'Longitude used for the forecast.'
  },
  'weather.locationName': {
    schema: z.string().trim().min(1).max(80),
    default: () => AppProperties.getString('weather.location.name', 'Vancouver'),
    description: 'Label shown for the forecast location.'
  },

  // --- news ---------------------------------------------------------------
  'news.maxArticles': {
    schema: z.number().int().min(5).max(200),
    default: () => 30,
    description: 'How many headlines the News page shows.'
  },
  'news.retentionDays': {
    schema: z.number().int().min(1).max(90),
    default: () => 7,
    description: 'How long fetched articles are kept before being pruned.'
  },

  // --- photos -------------------------------------------------------------
  'photos.slideshowSeconds': {
    schema: z.number().int().min(3).max(600),
    default: () => 20,
    description: 'Seconds each photo is shown in the slideshow.'
  }
}

export type SettingKey = keyof typeof SETTINGS

export function isKnownSetting(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key)
}

export function definitionFor(key: string): SettingDefinition | undefined {
  return isKnownSetting(key) ? SETTINGS[key] : undefined
}

/** The full default set, used to fill gaps for keys nobody has written yet. */
export function defaults(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, definition]) => [key, definition.default()]))
}

/** The catalogue as documentation, for the Settings page and /api/settings/catalog. */
export function catalog(): Array<{ key: string; description: string; default: unknown }> {
  return Object.entries(SETTINGS).map(([key, definition]) => ({
    key,
    description: definition.description,
    default: definition.default()
  }))
}
