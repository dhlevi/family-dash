/**
 * Domain shapes returned by the API.
 *
 * Repositories map database rows (snake_case, SQL types) onto these
 * (camelCase, JSON-friendly). Timestamps are ISO 8601 strings so the wire
 * format is unambiguous; plain dates are 'YYYY-MM-DD'.
 *
 * The Vue client mirrors these in web/src/api/types.ts.
 */

// --- calendar --------------------------------------------------------------

export type CalendarSourceType = 'local' | 'ics' | 'google'

export interface CalendarSource {
  id: string
  type: CalendarSourceType
  name: string
  colour: string
  enabled: boolean
  readOnly: boolean
  lastSyncAt: string | null
  lastError: string | null
  /**
   * Provider-specific configuration: `{ url }` for ics, OAuth details for
   * google, empty for local.
   *
   * An ICS feed URL is itself a bearer secret, but the UI has to show it to
   * be able to edit it, and this API is a LAN appliance with no accounts.
   * OAuth tokens are a different matter and are withheld — see
   * `publicConfig` in CalendarEndpoints.
   */
  config: Record<string, unknown>
}

export interface CalendarEvent {
  id: string
  sourceId: string
  externalUid: string | null
  title: string
  description: string | null
  location: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  rrule: string | null
  colour: string | null
}

/** An event as it exists in a provider, before it has a database identity. */
export interface ProviderEvent {
  externalUid: string | null
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date
  allDay: boolean
  rrule: string | null
}

export interface DateRange {
  from: Date
  to: Date
}

// --- weather ---------------------------------------------------------------

export type WeatherUnits = 'metric' | 'imperial'

export interface WeatherLocation {
  latitude: number
  longitude: number
  name: string
}

export interface WeatherCurrent {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  /** Degrees clockwise from north. */
  windDirection: number
  precipitation: number
  /** WMO weather code. Turned into an icon and a label by the UI. */
  code: number
  isDay: boolean
  observedAt: string
}

export interface WeatherHour {
  time: string
  temperature: number
  precipitationProbability: number
  code: number
  isDay: boolean
}

export interface WeatherDay {
  /** 'YYYY-MM-DD' in the location's own timezone. */
  date: string
  temperatureMin: number
  temperatureMax: number
  precipitationProbability: number
  precipitationSum: number
  sunrise: string | null
  sunset: string | null
  code: number
}

export interface WeatherReport {
  provider: string
  location: WeatherLocation
  units: WeatherUnits
  /** The location's IANA timezone, as the provider resolved it. */
  timezone: string
  current: WeatherCurrent
  hourly: WeatherHour[]
  daily: WeatherDay[]
  fetchedAt: string
  /**
   * True when this came from the database cache because the provider could
   * not be reached. The UI says so rather than showing stale numbers as if
   * they were current.
   */
  stale: boolean
}

export interface GeocodeResult {
  name: string
  /** "British Columbia, Canada" — enough to tell two Vancouvers apart. */
  region: string
  latitude: number
  longitude: number
  timezone: string | null
}

// --- recipes and meal planning ---------------------------------------------

export interface Ingredient {
  quantity: string | null
  unit: string | null
  item: string
}

export interface Recipe {
  id: string
  title: string
  description: string | null
  servings: number | null
  prepMinutes: number | null
  cookMinutes: number | null
  ingredients: Ingredient[]
  steps: string[]
  tags: string[]
  imagePath: string | null
  sourceUrl: string | null
  favourite: boolean
  createdAt: string
  updatedAt: string
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type MealSlot = (typeof MEAL_SLOTS)[number]

export interface MealPlanEntry {
  id: string
  /** 'YYYY-MM-DD' — a plain date, with no timezone attached. */
  planDate: string
  slot: MealSlot
  recipeId: string | null
  /** Denormalised for display, so a week grid is one query. */
  recipeTitle: string | null
  /** A scribbled "leftovers" when there is no recipe. */
  customText: string | null
  notes: string | null
}

export type ShoppingOrigin = 'manual' | 'meal_plan'

export interface ShoppingItem {
  id: string
  name: string
  quantity: string | null
  category: string | null
  checked: boolean
  origin: ShoppingOrigin
  recipeId: string | null
  createdAt: string
  updatedAt: string
}

// --- sticky notes ----------------------------------------------------------

export type NoteKind = 'text' | 'ink'

/** One point of a handwritten stroke, in capture-space pixels. */
export interface InkPoint {
  x: number
  y: number
  /** Stylus pressure, 0..1. A finger or mouse reports 0.5. */
  p: number
}

export interface InkStroke {
  colour: string
  width: number
  points: InkPoint[]
}

export interface StickyNote {
  id: string
  kind: NoteKind
  /** The text of a typed note, or an optional caption on a drawn one. */
  body: string
  colour: string
  /**
   * Position on the corkboard as a fraction of its width and height, so a
   * note stays where it was put when the screen is rotated between portrait
   * and landscape.
   */
  x: number
  y: number
  zIndex: number
  pinned: boolean
  strokes: InkStroke[]
  /** The coordinate space `strokes` were captured in. Null for typed notes. */
  inkWidth: number | null
  inkHeight: number | null
  createdAt: string
  updatedAt: string
}

// --- tasks and chores ------------------------------------------------------

export type TaskPriority = 0 | 1 | 2 | 3

export interface TaskItem {
  id: string
  title: string
  notes: string | null
  /** Free text: the household is shared, so this is a name, not a foreign key. */
  assignee: string | null
  category: string | null
  priority: TaskPriority
  dueAt: string | null
  completedAt: string | null
  recurrence: string | null
  createdAt: string
  updatedAt: string
}
