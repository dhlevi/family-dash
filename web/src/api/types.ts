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

export interface StickyNote {
  id: string
  body: string
  colour: string
  /** Fractions of the board (0..1) so positions survive a screen rotation. */
  x: number
  y: number
  zIndex: number
  pinned: boolean
  createdAt: string
  updatedAt: string
}

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
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealPlanEntry {
  id: string
  planDate: string
  slot: MealSlot
  recipeId: string | null
  recipeTitle: string | null
  customText: string | null
  notes: string | null
}

export interface ShoppingItem {
  id: string
  name: string
  quantity: string | null
  category: string | null
  checked: boolean
  origin: 'manual' | 'meal_plan'
  recipeId: string | null
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
  current: WeatherCurrent
  hourly: WeatherHour[]
  daily: WeatherDay[]
  fetchedAt: string
  /** True when the network is down and this came from the database cache. */
  stale: boolean
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
