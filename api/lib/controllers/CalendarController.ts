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
import { CalendarEndpoints } from '../services/CalendarEndpoints'
import type { SyncOutcome } from '../services/CalendarSyncService'
import type { CalendarEvent, CalendarSource } from '../types/domain'

const endpoints = new CalendarEndpoints()

/**
 * Calendar sources and events.
 *
 * Event reads come from the local cache that the background sync fills, so
 * they are fast and keep working when a feed or the network is unavailable.
 */
@Route('api/calendar')
export class CalendarController extends Controller {
  public constructor() {
    super()
  }

  // --- sources -------------------------------------------------------------

  @Get('sources')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getSources(): Promise<CalendarSource[]> {
    return endpoints.listSources()
  }

  /** Add a calendar. An ICS feed is validated before it is saved. */
  @Post('sources')
  @SuccessResponse(201, 'Created')
  @Response(400, 'Unsupported calendar type')
  @Response(422, 'Invalid configuration')
  @NoCache()
  public async postSource(@Body() body: unknown): Promise<CalendarSource> {
    return endpoints.createSource(body)
  }

  @Patch('sources/{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such source')
  @Response(422, 'Invalid configuration')
  @NoCache()
  public async patchSource(@Path('id') id: string, @Body() body: unknown): Promise<CalendarSource> {
    return endpoints.updateSource(id, body)
  }

  @Delete('sources/{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such source')
  @Response(409, 'The local calendar cannot be deleted')
  @NoCache()
  public async deleteSource(@Path('id') id: string): Promise<void> {
    return endpoints.deleteSource(id)
  }

  /** Fetch a feed now rather than waiting for the schedule. */
  @Post('sources/{id}/sync')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Source has no upstream feed')
  @Response(404, 'No such source')
  @NoCache()
  public async postSourceSync(@Path('id') id: string): Promise<SyncOutcome> {
    return endpoints.syncSource(id)
  }

  @Post('sync')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async postSyncAll(): Promise<SyncOutcome[]> {
    return endpoints.syncAll()
  }

  // --- events --------------------------------------------------------------

  /** Events overlapping a range. Defaults to the current month. */
  @Get('events')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Invalid range')
  @NoCache()
  public async getEvents(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sourceId') sourceId?: string
  ): Promise<CalendarEvent[]> {
    return endpoints.listEvents(from, to, sourceId)
  }

  /** The next events across every enabled calendar, for the dashboard. */
  @Get('events/upcoming')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getUpcoming(@Query('limit') limit?: number, @Query('days') days?: number): Promise<CalendarEvent[]> {
    return endpoints.upcoming(limit, days)
  }

  /** Create an event on a writable calendar, defaulting to the family one. */
  @Post('events')
  @SuccessResponse(201, 'Created')
  @Response(409, 'Calendar is read-only')
  @Response(422, 'Invalid event')
  @NoCache()
  public async postEvent(@Body() body: unknown): Promise<CalendarEvent> {
    return endpoints.createEvent(body)
  }

  @Patch('events/{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such event')
  @Response(409, 'Event comes from a subscribed calendar')
  @NoCache()
  public async patchEvent(@Path('id') id: string, @Body() body: unknown): Promise<CalendarEvent> {
    return endpoints.updateEvent(id, body)
  }

  @Delete('events/{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such event')
  @Response(409, 'Event comes from a subscribed calendar')
  @NoCache()
  public async deleteEvent(@Path('id') id: string): Promise<void> {
    return endpoints.deleteEvent(id)
  }
}
