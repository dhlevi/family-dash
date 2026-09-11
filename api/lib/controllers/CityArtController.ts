import { Controller } from '../core/Controller'
import { Delete, Get, NoCache, Path, Post, Query, Response, Route, SuccessResponse } from '../core/Decorators'
import { CityArtEndpoints, type CityRegionInfo, type MapThemeInfo } from '../services/CityArtEndpoints'
import type { CityArt, CityArtOutcome } from '../types/domain'

const endpoints = new CityArtEndpoints()

/**
 * Generated map artwork for the screensaver.
 *
 * Everything here reads the local cache the background task fills. The one
 * route that reaches the outside world is `POST generate`, and it is there so
 * somebody setting this up does not have to wait for the schedule to find out
 * whether they like the result.
 */
@Route('api/city-art')
export class CityArtController extends Controller {
  public constructor() {
    super()
  }

  /**
   * The catalogue of art styles.
   *
   * Declared above `{id}` because Express matches in registration order and
   * would otherwise read 'themes' as an id.
   */
  @Get('themes')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getThemes(): Promise<MapThemeInfo[]> {
    return endpoints.themes()
  }

  /** Which parts of the city list are available, and how many places each has. */
  @Get('regions')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getRegions(): Promise<CityRegionInfo[]> {
    return endpoints.regions()
  }

  /** The artwork the screensaver cycles through, newest first. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getPool(@Query('limit') limit?: number): Promise<CityArt[]> {
    return endpoints.pool(limit)
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such artwork')
  @NoCache()
  public async getById(@Path('id') id: string): Promise<CityArt> {
    return endpoints.byId(id)
  }

  /** Draws one now rather than waiting for the schedule. */
  @Post('generate')
  @SuccessResponse(200, 'OK')
  @Response(503, 'The tile server is unreachable')
  @NoCache()
  public async postGenerate(): Promise<CityArtOutcome> {
    return endpoints.generate()
  }

  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such artwork')
  @NoCache()
  public async deleteById(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
