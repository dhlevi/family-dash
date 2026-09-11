import { ApiError } from '../core/model/ApiError'
import { regionCounts } from '../providers/map/cities'
import { THEMES } from '../providers/map/themes'
import { CityArtService } from './CityArtService'
import type { CityArt, CityArtOutcome } from '../types/domain'

const service = new CityArtService()

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

/**
 * The screensaver's map artwork, as the UI sees it.
 *
 * Reads never draw anything: the Settings page and the screensaver both only
 * ever look at what the background task has already produced. Drawing is a
 * POST, and an explicit one.
 */
export class CityArtEndpoints {
  public async pool(limit?: number): Promise<CityArt[]> {
    const capped = Math.min(Math.max(limit ?? 20, 1), 60)
    return service.pool(capped)
  }

  public async byId(id: string): Promise<CityArt> {
    const art = await service.byId(id)
    if (!art) throw ApiError.notFound(`No map artwork with id '${id}'`)

    return art
  }

  /**
   * Draws one now.
   *
   * Forced, because the only reason to call this by hand is to see what the
   * themes look like before committing the screensaver to them.
   */
  public async generate(): Promise<CityArtOutcome> {
    return service.generate({ force: true })
  }

  public async remove(id: string): Promise<void> {
    const removed = await service.remove(id)
    if (!removed) throw ApiError.notFound(`No map artwork with id '${id}'`)
  }

  /** The catalogue of art styles, so the Settings page holds no list of its own. */
  public themes(): MapThemeInfo[] {
    return THEMES.map(theme => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      mood: theme.mood,
      background: theme.background
    }))
  }

  public regions(): CityRegionInfo[] {
    return regionCounts()
  }
}
