/**
 * Shapes exchanged with the API.
 *
 * Hand-written rather than generated: the API's OpenAPI document describes
 * routes and parameters but not response bodies (see the note in
 * api/lib/core/OpenApiGenerator.ts), so this file is the contract. Keep it in
 * step with the repositories on the API side.
 *
 * All timestamps are ISO 8601 strings in UTC; dates without a time
 * (meal plans) are 'YYYY-MM-DD'.
 */

// --- system ----------------------------------------------------------------

export interface SystemInfo {
  name: string
  version: string
  environment: string
  timezone: string
  configSource: string | null
  node: string
  platform: string
  uptimeSeconds: number
  routes: number
  healthChecks: string[]
  tasks: string[]
}

export interface TaskStatus {
  name: string
  cron: string
  enabled: boolean
  running: boolean
  lastRunAt: string | null
  lastDurationMs: number | null
  lastError: string | null
  runCount: number
  errorCount: number
}

export interface HealthCheck {
  name: string
  critical: boolean
  healthy: boolean
  durationMs: number
  message?: string
  detail?: Record<string, unknown>
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'unhealthy'
  uptimeSeconds: number
  version: string
  timestamp: string
  checks: HealthCheck[]
  tasks: TaskStatus[]
}

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
  /** `{ url }` for an ICS subscription; empty for the local calendar. */
  config: Record<string, unknown>
}

export interface SyncOutcome {
  sourceId: string
  name: string
  events: number
  error: string | null
  durationMs: number
}

export interface CalendarEvent {
  id: string
  sourceId: string
  /**
   * Set when the event came from a subscribed feed, which also means it
   * cannot be edited here — the next sync would undo the change.
   */
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

export interface NewCalendarEvent {
  sourceId?: string
  title: string
  description?: string | null
  location?: string | null
  startsAt: string
  endsAt: string
  allDay?: boolean
}

// --- tasks -----------------------------------------------------------------

/**
 * A short list of named intervals rather than RRULE: household chores are
 * "every day" or "school days", and five buttons beat a rule syntax on a
 * touchscreen. Feed events still get full RRULE expansion server-side.
 */
export const RECURRENCES = ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly'] as const

export type RecurrenceKind = (typeof RECURRENCES)[number]

export const RECURRENCE_LABELS: Record<RecurrenceKind, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month'
}

export interface TaskItem {
  id: string
  title: string
  notes: string | null
  /** Free text — the household is shared, so this is a name, not an id. */
  assignee: string | null
  category: string | null
  priority: 0 | 1 | 2 | 3
  dueAt: string | null
  completedAt: string | null
  recurrence: string | null
  createdAt: string
  updatedAt: string
}

// --- sticky notes ----------------------------------------------------------

export interface NewTaskItem {
  title: string
  notes?: string | null
  assignee?: string | null
  category?: string | null
  priority?: 0 | 1 | 2 | 3
  dueAt?: string | null
  recurrence?: RecurrenceKind | null
}

export interface TaskSummary {
  open: number
  dueSoon: number
  overdue: number
}

export interface TaskCompletion {
  completed: TaskItem
  /** The next occurrence, when the task recurs. */
  next: TaskItem | null
}

export interface TaskSuggestions {
  assignees: string[]
  categories: string[]
}

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
  /** Fractions of the board (0..1) so positions survive a screen rotation. */
  x: number
  y: number
  zIndex: number
  pinned: boolean
  strokes: InkStroke[]
  /**
   * The coordinate space `strokes` were captured in. Rendering through a
   * viewBox of this size reproduces the writing at any scale without
   * distorting it. Null for typed notes.
   */
  inkWidth: number | null
  inkHeight: number | null
  createdAt: string
  updatedAt: string
}

export interface NewStickyNote {
  kind: NoteKind
  body?: string
  colour?: string
  x?: number
  y?: number
  pinned?: boolean
  strokes?: InkStroke[]
  inkWidth?: number
  inkHeight?: number
}

/** The palette offered for notes. Chosen to stay legible in both themes. */
export const NOTE_COLOURS = [
  '#ffe066',
  '#ffd6a5',
  '#ffadad',
  '#bdb2ff',
  '#a0e7a0',
  '#9bf6ff',
  '#fdffb6',
  '#ffc6ff'
] as const

/** Ink colours. Dark enough to read on every note colour above. */
export const INK_COLOURS = ['#1a1f2b', '#1d4ed8', '#b3261e', '#0f6b4f', '#6b21a8'] as const

// --- recipes and meals -----------------------------------------------------

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

export interface NewRecipe {
  title: string
  description?: string | null
  servings?: number | null
  prepMinutes?: number | null
  cookMinutes?: number | null
  ingredients?: Ingredient[]
  steps?: string[]
  tags?: string[]
  sourceUrl?: string | null
  favourite?: boolean
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type MealSlot = (typeof MEAL_SLOTS)[number]

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack'
}

export interface MealPlanEntry {
  id: string
  /** 'YYYY-MM-DD' — a plain date, with no timezone attached. */
  planDate: string
  slot: MealSlot
  recipeId: string | null
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

export interface ShoppingList {
  items: ShoppingItem[]
  total: number
  remaining: number
}

// --- photos and drawings ---------------------------------------------------

export interface Photo {
  id: string
  /** Served from the API at /media/photos/<relPath> */
  relPath: string
  album: string
  filename: string
  width: number | null
  height: number | null
  takenAt: string | null
  thumbPath: string | null
  favourite: boolean
  url: string
  thumbUrl: string | null
}

export interface StrokePoint {
  x: number
  y: number
  /** Stylus pressure, 0..1. Mouse and finger input report 0.5. */
  pressure: number
}

export interface Stroke {
  colour: string
  width: number
  /** Eraser strokes composite differently but are otherwise ordinary strokes. */
  eraser: boolean
  points: StrokePoint[]
}

export interface Drawing {
  id: string
  title: string
  strokes: Stroke[]
  background: string
  width: number
  height: number
  thumbPath: string | null
  createdAt: string
  updatedAt: string
}

// --- news ------------------------------------------------------------------

export interface NewsFeed {
  id: string
  name: string
  url: string
  category: string | null
  enabled: boolean
  lastFetchAt: string | null
  lastError: string | null
}

export interface NewsArticle {
  id: string
  feedId: string
  feedName: string
  title: string
  link: string | null
  summary: string | null
  author: string | null
  imageUrl: string | null
  publishedAt: string | null
}

// --- weather ---------------------------------------------------------------

export type WeatherUnitSystem = 'metric' | 'imperial'

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
  windDirection: number
  precipitation: number
  /** WMO weather code; mapped to an icon and label in the UI. */
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
  units: 'metric' | 'imperial'
  /** The location's IANA timezone, as the provider resolved it. */
  timezone: string
  current: WeatherCurrent
  hourly: WeatherHour[]
  daily: WeatherDay[]
  fetchedAt: string
  /**
   * True when the provider could not be reached and this came from the
   * database cache. The UI says so rather than presenting old numbers as
   * current.
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

export interface WeatherProviderInfo {
  id: string
  name: string
  configured: boolean
  canGeocode: boolean
}

// --- settings --------------------------------------------------------------

export type DashboardWidget = 'calendar' | 'tasks' | 'weather' | 'meal' | 'notes' | 'news' | 'photos'

/**
 * The settings the API's catalogue declares. Typed by key so the store can
 * hand out a correctly-typed value without a cast at every call site.
 */
export interface AppSettings {
  'appearance.theme': 'dark' | 'light'
  'appearance.accent': string
  'appearance.clock24Hour': boolean
  'appearance.screensaverMinutes': number
  'dashboard.widgets': DashboardWidget[]
  'calendar.defaultView': 'month' | 'week' | 'agenda'
  'calendar.weekStartsOn': 0 | 1
  'calendar.dashboardDays': number
  'network.lanAddress': string
  'meals.slots': MealSlot[]
  'meals.weekStartsOn': 0 | 1
  'tasks.showCompleted': boolean
  'tasks.assignees': string[]
  'weather.units': 'metric' | 'imperial'
  'weather.latitude': number
  'weather.longitude': number
  'weather.locationName': string
  'news.maxArticles': number
  'news.retentionDays': number
  'photos.slideshowSeconds': number
}

export type SettingKey = keyof AppSettings

export interface SettingCatalogEntry {
  key: string
  description: string
  default: unknown
}

// --- paging ----------------------------------------------------------------

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pages: number
}
