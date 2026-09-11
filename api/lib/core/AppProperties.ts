import * as fs from 'fs'
import * as path from 'path'

/**
 * Configuration access for the service.
 *
 * Values are read from `config/application.properties` and may be overridden
 * by an environment variable. Environment always wins, which is how
 * docker-compose injects credentials and how the Raspberry Pi's `.env` file
 * reaches the container.
 *
 * The file format is the sectioned properties style the template used:
 *
 *   [server]
 *   port=3000          ->  server.port
 *
 * It is parsed here rather than with a library: it is a dozen lines of code,
 * and it keeps one more native-free dependency off the Pi.
 *
 * Usage:
 *   AppProperties.getString('server.port', '3000')
 *   AppProperties.getNumber('media.thumbnail.width', 480)
 *   AppProperties.getBoolean('tasks.enabled', true)
 */
export class AppProperties {
  private static values: Map<string, string> | null = null
  private static loadedFrom: string | null = null

  /**
   * Property key -> environment variable name, for the cases where the
   * conventional environment name differs from the generated one.
   */
  private static readonly ENV_OVERRIDES: Record<string, string> = {
    'server.port': 'PORT',
    'server.cors.origins': 'CORS_ORIGINS',
    'logging.level': 'LOG_LEVEL',
    'media.root': 'MEDIA_ROOT',
    'weather.latitude': 'DEFAULT_LATITUDE',
    'weather.longitude': 'DEFAULT_LONGITUDE',
    'weather.location.name': 'DEFAULT_LOCATION_NAME',
    'weather.units': 'DEFAULT_UNITS',
    'weather.provider': 'WEATHER_PROVIDER',
    'notify.ntfy.url': 'NTFY_URL',
    'notify.ntfy.publicUrl': 'NTFY_PUBLIC_URL',
    'notify.ntfy.token': 'NTFY_TOKEN',
    'google.clientId': 'GOOGLE_CLIENT_ID',
    'google.clientSecret': 'GOOGLE_CLIENT_SECRET',
    'database.migrate.onStartup': 'DB_MIGRATE_ON_STARTUP'
  }

  private constructor() {
    /* static only */
  }

  /**
   * Load the properties file. Safe to call more than once; the first
   * successful load wins. A missing file is not fatal.
   */
  public static initialize(configPath?: string): void {
    if (AppProperties.values) return

    const candidates = configPath
      ? [configPath]
      : [
          path.resolve(process.cwd(), 'config/application.properties'),
          path.resolve(__dirname, '../../config/application.properties'),
          path.resolve(__dirname, '../../../config/application.properties')
        ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        AppProperties.values = AppProperties.parse(fs.readFileSync(candidate, 'utf8'))
        AppProperties.loadedFrom = candidate
        console.info(`Loaded ${AppProperties.values.size} application properties from ${candidate}`)
        return
      }
    }

    AppProperties.values = new Map()
    console.warn('No application.properties found; using environment variables and defaults only')
  }

  public static source(): string | null {
    return AppProperties.loadedFrom
  }

  /** Test-only: forget the loaded file so a different one can be loaded. */
  public static reset(): void {
    AppProperties.values = null
    AppProperties.loadedFrom = null
  }

  public static getString(key: string, fallback: string): string
  public static getString(key: string): string | undefined
  public static getString(key: string, fallback?: string): string | undefined {
    const fromEnv = AppProperties.fromEnvironment(key)
    if (fromEnv !== undefined) return fromEnv

    const raw = AppProperties.values?.get(key)
    return raw === undefined || raw === '' ? fallback : raw
  }

  public static getNumber(key: string, fallback: number): number {
    const raw = AppProperties.getString(key)
    if (raw === undefined) return fallback

    const parsed = Number(raw)
    if (Number.isNaN(parsed)) {
      console.warn(`Property '${key}' is not a number ('${raw}'); falling back to ${fallback}`)
      return fallback
    }

    return parsed
  }

  public static getBoolean(key: string, fallback: boolean): boolean {
    const raw = AppProperties.getString(key)
    if (raw === undefined) return fallback

    return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase())
  }

  /** Comma-separated property as a trimmed, non-empty list. */
  public static getList(key: string, fallback: string[] = []): string[] {
    const raw = AppProperties.getString(key)
    if (raw === undefined) return fallback

    const values = raw
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0)

    return values.length > 0 ? values : fallback
  }

  /**
   * Parse the sectioned properties format. Keys outside any section keep
   * their bare name; keys inside `[section]` are prefixed with it.
   */
  private static parse(contents: string): Map<string, string> {
    const values = new Map<string, string>()
    let section = ''

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('!')) continue

      const sectionMatch = /^\[(.+)]$/.exec(trimmed)
      if (sectionMatch?.[1]) {
        section = sectionMatch[1].trim()
        continue
      }

      const separator = trimmed.indexOf('=')
      if (separator < 0) continue

      const key = trimmed.slice(0, separator).trim()
      // Values are taken verbatim after the first '=' so cron expressions
      // and URLs containing '=' survive intact.
      const value = trimmed.slice(separator + 1).trim()
      if (key.length === 0) continue

      values.set(section ? `${section}.${key}` : key, value)
    }

    return values
  }

  private static fromEnvironment(key: string): string | undefined {
    const explicit = AppProperties.ENV_OVERRIDES[key]
    if (explicit) {
      const value = process.env[explicit]
      if (value !== undefined && value !== '') return value
    }

    const generated = process.env[AppProperties.envNameFor(key)]
    return generated !== undefined && generated !== '' ? generated : undefined
  }

  /** 'media.thumbnail.width' -> 'MEDIA_THUMBNAIL_WIDTH' */
  private static envNameFor(key: string): string {
    return key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[.-]/g, '_')
      .toUpperCase()
  }
}
