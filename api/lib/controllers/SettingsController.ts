import { Controller } from '../core/Controller'
import { Body, Delete, Get, NoCache, Patch, Path, Put, Response, Route, SuccessResponse } from '../core/Decorators'
import { SettingsEndpoints } from '../services/SettingsEndpoints'

const endpoints = new SettingsEndpoints()

/**
 * Application preferences, as edited on the Settings page.
 */
@Route('api/settings')
export class SettingsController extends Controller {
  public constructor() {
    super()
  }

  /** Every setting, stored values layered over the defaults. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getAll(): Promise<Record<string, unknown>> {
    return endpoints.all()
  }

  /** The available settings with their descriptions and defaults. */
  @Get('catalog')
  @SuccessResponse(200, 'OK')
  public async getCatalog(): Promise<Array<{ key: string; description: string; default: unknown }>> {
    return endpoints.catalog()
  }

  /** Update several settings at once. Validated as a batch. */
  @Patch('')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Unknown setting key')
  @Response(422, 'Invalid value')
  @NoCache()
  public async patchAll(@Body() body: unknown): Promise<Record<string, unknown>> {
    return endpoints.update(body)
  }

  @Get('{key}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'Unknown setting')
  @NoCache()
  public async getOne(@Path('key') key: string): Promise<{ key: string; value: unknown }> {
    return endpoints.get(key)
  }

  /** Set one setting. Accepts a bare value or `{ "value": ... }`. */
  @Put('{key}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'Unknown setting')
  @Response(422, 'Invalid value')
  @NoCache()
  public async putOne(@Path('key') key: string, @Body() body: unknown): Promise<{ key: string; value: unknown }> {
    return endpoints.set(key, body)
  }

  /** Reset one setting back to its default. */
  @Delete('{key}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'Unknown setting')
  @NoCache()
  public async deleteOne(@Path('key') key: string): Promise<{ key: string; value: unknown }> {
    return endpoints.reset(key)
  }
}
