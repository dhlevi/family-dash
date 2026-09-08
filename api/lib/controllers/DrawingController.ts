import { Controller } from '../core/Controller'
import {
  Body,
  Delete,
  Get,
  NoCache,
  Patch,
  Path,
  Post,
  Query,
  Response,
  Route,
  SuccessResponse
} from '../core/Decorators'
import { DrawingEndpoints } from '../services/DrawingEndpoints'
import type { Drawing } from '../types/domain'

const endpoints = new DrawingEndpoints()

/**
 * Freehand drawings.
 *
 * Stored as vector strokes in the coordinate space they were drawn in — the
 * same model as a handwritten sticky note — so the gallery can render its
 * own thumbnails at any size without keeping a rasterised copy in step.
 */
@Route('api/drawings')
export class DrawingController extends Controller {
  public constructor() {
    super()
  }

  /** Most recently worked on first. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getDrawings(@Query('limit') limit?: number): Promise<Drawing[]> {
    return endpoints.list(limit)
  }

  @Get('count')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getCount(): Promise<{ total: number }> {
    return endpoints.count()
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such drawing')
  @NoCache()
  public async getDrawing(@Path('id') id: string): Promise<Drawing> {
    return endpoints.byId(id)
  }

  @Post('')
  @SuccessResponse(201, 'Created')
  @Response(422, 'Invalid drawing')
  @NoCache()
  public async postDrawing(@Body() body: unknown): Promise<Drawing> {
    return endpoints.create(body)
  }

  @Patch('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such drawing')
  @Response(422, 'Invalid drawing')
  @NoCache()
  public async patchDrawing(@Path('id') id: string, @Body() body: unknown): Promise<Drawing> {
    return endpoints.update(id, body)
  }

  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such drawing')
  @NoCache()
  public async deleteDrawing(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
