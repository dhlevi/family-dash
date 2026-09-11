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
  /** The RRULE text of a feed event, for reference. Never interpreted here. */
  rrule: string | null
  /** How a local event repeats. Null for a one-off. */
  recurrence: RecurrenceKind | null
  /** When the series stops. Null repeats indefinitely. */
  recurrenceUntil: string | null
  /**
   * The event defining the series, on every occurrence including the first.
   * Null when the event does not repeat — which is what tells the editor
   * whether to offer "this one" or "all of them".
   */
  seriesId: string | null
  /**
   * When the series itself begins. The editor shows this rather than the
   * occurrence that was tapped, because an edit applies to the whole series.
   */
  seriesStartsAt: string | null
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
  recurrence?: RecurrenceKind | null
  recurrenceUntil?: string | null
}

/** Whether a delete takes one occurrence out of a series, or the lot. */
export type DeleteScope = 'occurrence' | 'series'

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
  /** A photo in the library. Cleared automatically if that photo is deleted. */
  photoId: string | null
  /** Resolved by the API, so media URLs are never built here. */
  photoThumbUrl: string | null
  photoUrl: string | null
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
  photoId?: string | null
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

/** What the screensaver shows when the display has been left alone. */
export type ScreensaverSource = 'gallery' | 'map' | 'both'

export type CityArtOrientation = 'landscape' | 'portrait'

// --- generated map artwork -------------------------------------------------

export interface CityArt {
  id: string
  cityKey: string
  cityName: string
  region: string
  country: string
  latitude: number
  longitude: number
  theme: string
  themeName: string
  /** The theme's background, painted behind the picture while it loads. */
  background: string
  width: number
  height: number
  url: string
  /** The small version, for a grid of them. Made on demand. */
  thumbUrl: string
  /** The vector master — resolution independent, and the one to print. */
  svgUrl: string
  createdAt: string
}

export interface CityArtOutcome {
  created: CityArt | null
  skipped: string[]
  pruned: number
  reason: string | null
}

export interface MapThemeInfo {
  id: string
  name: string
  description: string
  mood: 'light' | 'dark'
  background: string
}

export interface CityRegionInfo {
  region: string
  label: string
  count: number
}

// --- the household strip ---------------------------------------------------

export interface PersonDay {
  name: string
  colour: string
  tasks: TaskItem[]
  events: CalendarEvent[]
  laterCount: number
  doneToday: number
}

// --- bin day ---------------------------------------------------------------

export type BinKind = 'garbage' | 'recycling' | 'organics' | 'yard' | 'glass'

export type BinUrgency = 'tonight' | 'today' | 'tomorrow' | 'upcoming'

export interface BinCollectionView {
  /** The local calendar day, as 'YYYY-MM-DD'. */
  date: string
  kinds: BinKind[]
  /** The calendar's own wording, always shown in case the guess is wrong. */
  titles: string[]
  urgency: BinUrgency
  /** Whole days from today: 0 is today, 1 tomorrow. */
  inDays: number
}

export interface BinOutlook {
  next: BinCollectionView | null
  following: BinCollectionView | null
  sourcesChosen: boolean
}

export interface PersonProfile {
  colour?: string
  calendarSourceIds?: string[]
}

export interface Photo {
  id: string
  /** Subfolder in the library, or '' for the loose files at the top of it. */
  album: string
  filename: string
  mimeType: string | null
  width: number | null
  height: number | null
  sizeBytes: number | null
  /** From EXIF where the camera recorded it, otherwise the file's own date. */
  takenAt: string | null
  /**
   * Where to fetch the picture. Given by the API rather than built here, and
   * carries a version so a photo replaced on the volume is not hidden behind
   * the year-long cache these are served with.
   */
  url: string
  thumbUrl: string
  favourite: boolean
  createdAt: string
  updatedAt: string
}

export interface PhotoAlbum {
  /** '' for the loose files at the top of the library. */
  name: string
  count: number
  coverPhotoId: string | null
  latestTakenAt: string | null
}

export interface PhotoUploadOutcome {
  added: Photo[]
  /** Files the API refused, with the reason, so the page can say which. */
  rejected: Array<{ filename: string; reason: string }>
}

export interface PhotoScanOutcome {
  added: number
  removed: number
  updated: number
  thumbnailed: number
  skipped: number
  durationMs: number
}

/** The label for the album with no folder of its own. */
export const LOOSE_ALBUM_LABEL = 'Everything else'

export function albumLabel(name: string): string {
  return name.length > 0 ? name : LOOSE_ALBUM_LABEL
}

export interface Drawing {
  id: string
  title: string
  strokes: InkStroke[]
  background: string
  /** The coordinate space `strokes` were captured in. */
  width: number
  height: number
  createdAt: string
  updatedAt: string
}

export interface NewDrawing {
  title?: string
  strokes: InkStroke[]
  background?: string
  width: number
  height: number
}

/**
 * The drawing palette — wider than the note ink set, since a picture wants
 * more than five pens. All dark enough to read on the paper colours below.
 */
export const DRAW_COLOURS = [
  '#1a1f2b',
  '#1d4ed8',
  '#0284c7',
  '#0f6b4f',
  '#65a30d',
  '#b3261e',
  '#ea580c',
  '#a16207',
  '#6b21a8',
  '#be185d'
] as const

export const DRAW_WIDTHS = [2, 4, 8, 14, 24] as const

/** Paper colours. Kept pale so every ink colour stays legible on them. */
export const PAPER_COLOURS = ['#ffffff', '#fdf6e3', '#eef2f7', '#eaf4fb', '#fdeef2'] as const

// --- news ------------------------------------------------------------------

export interface NewsFeed {
  id: string
  name: string
  url: string
  category: string | null
  enabled: boolean
  lastFetchAt: string | null
  lastError: string | null
  /** How many articles are currently cached from this feed. */
  articleCount?: number
}

export interface NewsArticle {
  id: string
  feedId: string
  feedName: string
  feedCategory: string | null
  title: string
  link: string | null
  /**
   * Always plain text. Feed HTML is stripped by the API, so this is safe to
   * render as a text node — which is the only way it is ever rendered.
   */
  summary: string | null
  author: string | null
  imageUrl: string | null
  publishedAt: string | null
}

export interface NewsFetchOutcome {
  feedId: string
  name: string
  articles: number
  error: string | null
  durationMs: number
}

// --- google calendar -------------------------------------------------------

export interface GoogleCalendarStatus {
  /** Whether the server has an OAuth client at all. */
  configured: boolean
  clientId: string
  sources: Array<{
    id: string
    name: string
    connected: boolean
    calendarId: string | null
    lastError: string | null
  }>
}

export interface GoogleCalendarSummary {
  id: string
  name: string
  primary: boolean
  writable: boolean
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

export type DashboardWidget =
  'calendar' | 'tasks' | 'people' | 'bins' | 'weather' | 'meal' | 'notes' | 'news' | 'photos'

/**
 * The settings the API's catalogue declares. Typed by key so the store can
 * hand out a correctly-typed value without a cast at every call site.
 */
/** What the theme setting can hold. 'auto' follows the sun. */
export type ThemePreference = 'dark' | 'light' | 'auto'

/** What is actually applied to the document. */
export type Theme = 'dark' | 'light'

/** When to put a keyboard on screen. `auto` decides per device. */
export type KeyboardMode = 'auto' | 'always' | 'never'

export interface AppSettings {
  'appearance.theme': ThemePreference
  'appearance.autoThemeOffsetMinutes': number
  'appearance.accent': string
  'appearance.clock24Hour': boolean
  'appearance.screensaverMinutes': number
  'appearance.screensaverSource': ScreensaverSource
  'people.profiles': Record<string, PersonProfile>
  'bins.sourceIds': string[]
  'bins.eveningHour': number
  'cityart.regions': string[]
  'cityart.themes': string[]
  'cityart.poolSize': number
  'cityart.orientation': CityArtOrientation
  'input.onScreenKeyboard': KeyboardMode
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
