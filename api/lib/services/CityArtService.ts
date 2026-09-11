import * as crypto from 'crypto'
import sharp from 'sharp'
import { AppProperties } from '../core/AppProperties'
import { citiesIn, type City } from '../providers/map/cities'
import { boundsFor, tilesCovering } from '../providers/map/mercator'
import { renderMapArt } from '../providers/map/MapArtRenderer'
import { THEMES, themeById, type MapTheme } from '../providers/map/themes'
import { TileSource } from '../providers/map/TileSource'
import { CityArtRepository } from '../repositories/CityArtRepository'
import { SettingRepository } from '../repositories/SettingRepository'
import { MediaStore } from './MediaStore'
import type { CityArt, CityArtOutcome } from '../types/domain'

const repository = new CityArtRepository()
const settings = new SettingRepository()

/**
 * Drawing the map artwork, and keeping the pool topped up.
 *
 * The whole point of doing this here rather than in the browser is that the
 * Raspberry Pi driving the wall should never be the thing rendering a map.
 * Tiles are fetched, drawn and rasterised once by the API; the screensaver
 * loads a finished picture, which costs it exactly what showing a photograph
 * costs. That also means the artwork keeps working with no network at all,
 * which matters more here than anywhere else in the application.
 */
export class CityArtService {
  /**
   * How sparse a picture may be before it is thrown away.
   *
   * Some places have almost nothing mapped, and the result is a flat rectangle
   * of background with three lines on it. Rather than put that on the wall,
   * the generator counts what it drew and tries somewhere else.
   *
   * This is here to catch the genuinely empty maps, not low-feature ones.
   */
  private static readonly MIN_FEATURES = 120

  /** How many cities to try before giving up for this run. */
  private static readonly MAX_ATTEMPTS = 4

  /** Where the screensaver source setting lives, mirrored from SettingsCatalog. */
  private static readonly SOURCE_KEY = 'appearance.screensaverSource'

  /** The long edge of a generated picture, matching the theme reference width. */
  private static longEdge(): number {
    return AppProperties.getNumber('cityart.size', 2000)
  }

  public async configuration(): Promise<{
    enabled: boolean
    regions: string[]
    themes: string[]
    poolSize: number
    portrait: boolean
  }> {
    const stored = await settings.all()
    const source = stored[CityArtService.SOURCE_KEY]

    return {
      // Nothing is drawn while the screensaver is showing photographs. A
      // background task quietly pulling tiles for pictures nobody will see is
      // rude to a tile server that is given away for free.
      enabled: source === 'map' || source === 'both',
      regions: Array.isArray(stored['cityart.regions']) ? (stored['cityart.regions'] as string[]) : [],
      themes: Array.isArray(stored['cityart.themes']) ? (stored['cityart.themes'] as string[]) : [],
      poolSize: typeof stored['cityart.poolSize'] === 'number' ? (stored['cityart.poolSize'] as number) : 12,
      portrait: stored['cityart.orientation'] === 'portrait'
    }
  }

  /** The artwork the screensaver cycles through, newest first. */
  public async pool(limit: number): Promise<CityArt[]> {
    return repository.list(limit)
  }

  public async byId(id: string): Promise<CityArt | null> {
    return repository.byId(id)
  }

  public async remove(id: string): Promise<boolean> {
    const files = await repository.remove(id)
    if (!files) return false

    await MediaStore.removeCityArt(files.svgPath, files.rasterPath, MediaStore.cityArtThumbName(id))
    return true
  }

  /**
   * Chooses somewhere that has not been drawn lately.
   *
   * Recency is tracked over twice the pool size, so a city cannot come back
   * while a picture of it is still in rotation, and randomness does the rest.
   * With a few hundred candidates this is enough to make repeats rare without
   * the bookkeeping of a shuffled queue that would have to survive restarts.
   */
  private async chooseCities(regions: string[], poolSize: number): Promise<City[]> {
    const candidates = citiesIn(regions)
    if (candidates.length === 0) return []

    const recent = new Set(await repository.recentCityKeys(poolSize * 2))
    const fresh = candidates.filter(city => !recent.has(city.key))

    // Everything has been drawn recently so fall back to the full list rather than drawing nothing.
    const pool = [...(fresh.length > 0 ? fresh : candidates)]

    // Partial Fisher-Yates. `sort(() => Math.random() - 0.5)` looks like a
    // shuffle and is not one: it leans towards the original order, most
    // strongly at the ends of the array, which here would mean the first few
    // cities in the list turning up far more often than the rest.
    const wanted = Math.min(CityArtService.MAX_ATTEMPTS, pool.length)
    for (let index = 0; index < wanted; index++) {
      const pick = index + Math.floor(Math.random() * (pool.length - index))
      ;[pool[index], pool[pick]] = [pool[pick]!, pool[index]!]
    }

    return pool.slice(0, wanted)
  }

  private chooseTheme(allowed: string[]): MapTheme {
    const usable = allowed.map(themeById).filter((theme): theme is MapTheme => theme !== undefined)
    const pool = usable.length > 0 ? usable : THEMES

    return pool[Math.floor(Math.random() * pool.length)]!
  }

  /**
   * Draws one artwork and adds it to the pool.
   *
   * Tries a few cities before giving up: a place with too little in
   * OpenStreetMap to make a picture is not an error, it is a reason to go
   * somewhere else. Anything that *is* an error is thrown, recorded
   * against the task, and surfaced in Settings.
   */
  public async generate(options: { force?: boolean } = {}): Promise<CityArtOutcome> {
    const configuration = await this.configuration()
    const outcome: CityArtOutcome = { created: null, skipped: [], pruned: 0, reason: null }

    if (!configuration.enabled && !options.force) {
      outcome.reason = 'The screensaver is set to photographs, so no map artwork is being drawn'
      return outcome
    }

    const cities = await this.chooseCities(configuration.regions, configuration.poolSize)
    if (cities.length === 0) {
      outcome.reason = 'No cities match the selected regions'
      return outcome
    }

    const longEdge = CityArtService.longEdge()
    const width = configuration.portrait ? Math.round(longEdge * 0.625) : longEdge
    const height = configuration.portrait ? longEdge : Math.round(longEdge * 0.625)

    for (const city of cities) {
      const theme = this.chooseTheme(configuration.themes)
      const bounds = boundsFor(city.latitude, city.longitude, city.spanMetres, width, height)
      const tiles = await TileSource.fetchTiles(tilesCovering(bounds))

      const { svg, featureCount } = renderMapArt(tiles, bounds, { theme, width, height })

      if (featureCount < CityArtService.MIN_FEATURES) {
        outcome.skipped.push(`${city.name} (${featureCount} features)`)
        continue
      }

      const id = crypto.randomUUID()
      const svgPath = `${id}.svg`
      const rasterPath = `${id}.webp`

      try {
        await MediaStore.writeCityArt(svgPath, svg)

        // Rasterising is what keeps the Pi's side of this cheap. librsvg does
        // the work here, once, instead of the kiosk browser doing it on every
        // screensaver cycle.
        const raster = await sharp(Buffer.from(svg), { density: 96 }).webp({ quality: 88 }).toBuffer()
        await MediaStore.writeCityArt(rasterPath, raster)

        outcome.created = await repository.insert({
          cityKey: city.key,
          cityName: city.name,
          region: city.region,
          country: city.country,
          latitude: city.latitude,
          longitude: city.longitude,
          theme: theme.id,
          svgPath,
          rasterPath,
          width,
          height,
          featureCount
        })
      } catch (error) {
        // The files go down before the row does. Without this, a failed insert
        // leaves two files on the media volume that nothing points at and no
        // prune will ever reach, once every three hours, forever.
        await MediaStore.removeCityArt(svgPath, rasterPath)
        throw error
      }

      break
    }

    if (!outcome.created && outcome.reason === null) {
      outcome.reason = `Nothing worth drawing at ${outcome.skipped.join(', ')}`
    }

    const trimmed = await repository.trimTo(configuration.poolSize)
    for (const files of trimmed) {
      // The thumbnail is named from the id, and the id is the stem of the SVG.
      const id = files.svgPath.replace(/\.svg$/, '')
      await MediaStore.removeCityArt(files.svgPath, files.rasterPath, MediaStore.cityArtThumbName(id))
    }
    outcome.pruned = trimmed.length

    return outcome
  }
}
