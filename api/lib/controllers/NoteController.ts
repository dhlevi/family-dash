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
import { NoteEndpoints } from '../services/NoteEndpoints'
import type { StickyNote } from '../types/domain'

const endpoints = new NoteEndpoints()

/**
 * Sticky notes on the family corkboard.
 *
 * A note is either typed or handwritten. Handwritten notes carry their
 * strokes in the coordinate space they were drawn in, so they can be
 * re-rendered at any size.
 */
@Route('api/notes')
export class NoteController extends Controller {
  public constructor() {
    super()
  }

  /** Every note in stacking order, or just the pinned ones. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getNotes(
    @Query('pinnedOnly') pinnedOnly?: boolean,
    @Query('limit') limit?: number
  ): Promise<StickyNote[]> {
    return endpoints.list(pinnedOnly, limit)
  }

  @Get('counts')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getCounts(): Promise<{ total: number; pinned: number }> {
    return endpoints.counts()
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such note')
  @NoCache()
  public async getNote(@Path('id') id: string): Promise<StickyNote> {
    return endpoints.byId(id)
  }

  @Post('')
  @SuccessResponse(201, 'Created')
  @Response(422, 'Invalid note')
  @NoCache()
  public async postNote(@Body() body: unknown): Promise<StickyNote> {
    return endpoints.create(body)
  }

  /** Update text, colour, pin state, board position or strokes. */
  @Patch('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such note')
  @Response(409, 'Cannot change a note between typed and handwritten')
  @Response(422, 'Invalid note')
  @NoCache()
  public async patchNote(@Path('id') id: string, @Body() body: unknown): Promise<StickyNote> {
    return endpoints.update(id, body)
  }

  @Post('{id}/front')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such note')
  @NoCache()
  public async postToFront(@Path('id') id: string): Promise<StickyNote> {
    return endpoints.bringToFront(id)
  }

  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such note')
  @NoCache()
  public async deleteNote(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
