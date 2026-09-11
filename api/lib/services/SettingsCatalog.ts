import { z } from 'zod'
import { AppProperties } from '../core/AppProperties'
import { CITY_REGIONS } from '../providers/map/cities'
import { themeIds } from '../providers/map/themes'

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

export const DASHBOARD_WIDGETS = [
  'calendar',
  'tasks',
  'people',
  'bins',
  'weather',
  'meal',
  'notes',
  'news',
  'photos'
] as const
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
    description: 'Idle minutes before the screen turns into a slideshow. Any tap or key dismisses it. 0 disables it.'
  },
  'appearance.screensaverSource': {
    schema: z.enum(['gallery', 'map', 'both']),
    default: () => 'gallery',
    description:
      'What the screensaver shows: pictures from the photo library, generated map artwork of a ' +
      'different city each time, or both in rotation. Map artwork needs no photographs and no ' +
      'account anywhere, and is only drawn while this is set to use it.'
  },

  // --- map artwork --------------------------------------------------------
  'cityart.regions': {
    schema: z.array(z.enum(CITY_REGIONS)),
    default: () => [],
    description: 'Which parts of the city list the screensaver draws from. Empty means all of them.'
  },
  'cityart.themes': {
    schema: z
      .array(z.string().trim().min(1))
      .refine(
        values => values.every(value => themeIds().includes(value)),
        'Every entry must be one of the available map themes'
      ),
    default: () => [],
    description: 'Which art styles to use for map artwork. Empty means all of them.'
  },
  'cityart.poolSize': {
    schema: z.number().int().min(4).max(60),
    default: () => 12,
    description:
      'How many generated maps to keep. Older ones are deleted as new ones are drawn; a dozen is ' +
      'a few megabytes and more variety than anyone notices in an evening.'
  },
  'cityart.orientation': {
    schema: z.enum(['landscape', 'portrait']),
    default: () => 'landscape',
    description:
      'Shape of the generated artwork. Set this to match how the display is mounted, or the ' +
      'picture will be cropped to fit the screen.'
  },

  // --- input ---------------------------------------------------------------
  'input.onScreenKeyboard': {
    schema: z.enum(['auto', 'always', 'never']),
    default: () => 'auto',
    description:
      'Show a keyboard on screen when a text field is tapped. Auto decides per device — on for a ' +
      'touchscreen, off where there is a mouse — which matters because this setting is shared by ' +
      'every screen looking at the same install.'
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
    description:
      'The people in the household. Used as suggestions when assigning a task, and as the columns ' +
      'of the per-person strip on the dashboard. Assignment is still free text, so this is a ' +
      'shortcut rather than a list of accounts.'
  },

  // --- people -------------------------------------------------------------
  'people.profiles': {
    schema: z.record(
      z.string().trim().min(1).max(40),
      z
        .object({
          colour: hexColour.optional(),
          calendarSourceIds: z.array(z.string().uuid()).max(20).optional()
        })
        .strict()
    ),
    default: () => ({}),
    description:
      "Per-person display settings, keyed by the names in 'tasks.assignees'. A colour, and which " +
      'calendars belong to that person — events have no assignee of their own, so linking a ' +
      'calendar is how the strip knows whose day is whose. Everything here is optional.'
  },

  // --- bin day ------------------------------------------------------------
  'bins.sourceIds': {
    schema: z.array(z.string().uuid()).max(10),
    default: () => [],
    description:
      'Which calendars carry the waste collection schedule. Most councils publish one as an ICS ' +
      'feed you can subscribe to like any other. Leave this empty to look across every calendar ' +
      'for events that read like collections.'
  },
  'bins.eveningHour': {
    schema: z.number().int().min(0).max(23),
    default: () => 16,
    description:
      "The hour after which tomorrow's collection starts asking for the bins to go out tonight. " +
      'A reminder on the morning itself is too late to be any use.'
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
