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
  /**
   * The stored row's id, except for the second and later occurrences of a
   * local series, which have none of their own and carry `<seriesId>::<start>`.
   */
  id: string
  sourceId: string
  externalUid: string | null
  title: string
  description: string | null
  location: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  /** The RRULE text of a feed event, for reference. Never interpreted here. */
  rrule: string | null
  /** How a *local* event repeats: the same vocabulary chores use. */
  recurrence: string | null
  /** When the series stops. Null repeats indefinitely. */
  recurrenceUntil: string | null
  /**
   * The row defining the series this came from, on every occurrence including
   * the first. Null for an event that does not repeat, which is what tells the
   * UI whether to offer "this one" or "all of them".
   */
  seriesId: string | null
  /**
   * When the series itself begins, on every occurrence of it.
   *
   * The editor needs this because an edit applies to the whole series: opening
   * the third Tuesday and saving without touching anything must not quietly
   * move the series onto that Tuesday and drop the two before it.
   */
  seriesStartsAt: string | null
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

// --- photos ----------------------------------------------------------------

/**
 * A picture in the library, as the UI sees it.
 *
 * Where the file actually sits on the media volume is not part of this: the
 * browser addresses images by id through `url`/`thumbUrl`, and the paths
 * stay inside the API (see `PhotoFile`).
 */
export interface Photo {
  id: string
  /** Subfolder name, or '' for loose files at the top of the library. */
  album: string
  filename: string
  mimeType: string | null
  width: number | null
  height: number | null
  sizeBytes: number | null
  /** When the picture was taken, from EXIF where present, else the file's date. */
  takenAt: string | null
  /** Where the browser fetches the full image. Addressed by id, not by path. */
  url: string
  /** Where the browser fetches the small version. Falls back to the original. */
  thumbUrl: string
  favourite: boolean
  createdAt: string
  updatedAt: string
}

/** The on-disk side of a photo. Never leaves the API. */
export interface PhotoFile {
  id: string
  relPath: string
  thumbPath: string | null
  mimeType: string | null
  filename: string
}

export interface PhotoAlbum {
  /** '' for the loose files at the top of the library. */
  name: string
  count: number
  /** The newest photo in the album, for the album's cover tile. */
  coverPhotoId: string | null
  latestTakenAt: string | null
}

// --- drawings --------------------------------------------------------------

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
  /** Denormalised so a headline list is one query. */
  feedName: string
  feedCategory: string | null
  title: string
  link: string | null
  /** Always plain text: feed HTML never reaches the browser. */
  summary: string | null
  author: string | null
  imageUrl: string | null
  publishedAt: string | null
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
  /** A photo in the library, or null. Cleared automatically if that photo is deleted. */
  photoId: string | null
  /** Resolved from `photoId`, so the client never builds a media URL. */
  photoThumbUrl: string | null
  photoUrl: string | null
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

// --- generated map artwork -------------------------------------------------

export interface CityArt {
  id: string
  /** The entry in the curated city list this was drawn from. */
  cityKey: string
  cityName: string
  /** Which part of the list it came from: 'world', 'wales', and so on. */
  region: string
  country: string
  latitude: number
  longitude: number
  theme: string
  /** The theme's display name, resolved when the row is read. */
  themeName: string
  /**
   * The theme's background colour.
   *
   * Handed to the UI so it can paint the right colour behind an artwork that
   * is still loading, rather than flashing black between pictures.
   */
  background: string
  width: number
  height: number
  url: string
  /** The small version, for a grid of them. Made on demand. */
  thumbUrl: string
  svgUrl: string
  createdAt: string
}

/** The on-disk side of an artwork. Never leaves the API. */
export interface CityArtFile {
  id: string
  svgPath: string
  rasterPath: string | null
  cityName: string
}

export interface CityArtOutcome {
  /** The artwork that was drawn, or null if nothing was. */
  created: CityArt | null
  /** Cities passed over because OpenStreetMap had too little to draw. */
  skipped: string[]
  /** How many old artworks were deleted to stay within the pool size. */
  pruned: number
  /** Why nothing was drawn, when `created` is null. */
  reason: string | null
}

// --- the household strip ---------------------------------------------------

export interface PersonDay {
  name: string
  /** Chosen in Settings, or derived from the name so it is stable. */
  colour: string
  /** Open tasks that are overdue or due today, soonest first. */
  tasks: TaskItem[]
  /** Today's events, from whichever calendars are linked to this person. */
  events: CalendarEvent[]
  /** Open tasks waiting behind today: undated, or due later. */
  laterCount: number
  /** Finished since midnight. The only cheerful number on the strip. */
  doneToday: number
}

// --- bin day ---------------------------------------------------------------

export type BinKindName = 'garbage' | 'recycling' | 'organics' | 'yard' | 'glass'

export type BinUrgencyName = 'tonight' | 'today' | 'tomorrow' | 'upcoming'

export interface BinCollectionView {
  /** The local calendar day, as 'YYYY-MM-DD'. */
  date: string
  kinds: BinKindName[]
  /** The calendar's own wording, always shown in case the guess is wrong. */
  titles: string[]
  urgency: BinUrgencyName
  /** Whole days from today: 0 is today, 1 tomorrow. */
  inDays: number
}

export interface BinOutlook {
  next: BinCollectionView | null
  /** The one after, shown faintly so the rhythm is visible. */
  following: BinCollectionView | null
  /** Whether any calendar has been nominated as a collection schedule. */
  sourcesChosen: boolean
}
