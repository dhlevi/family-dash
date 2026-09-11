import type { Request, Response as ExpressResponse } from 'express'
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
  Req,
  Res,
  Response,
  Route,
  SuccessResponse
} from '../core/Decorators'
import { CalendarEndpoints, type GoogleCallbackResult, type GoogleStatus } from '../services/CalendarEndpoints'
import type { GoogleCalendarSummary } from '../providers/calendar/GoogleProvider'
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
  /**
   * The callback address, as this request reached the dashboard.
   *
   * Google requires the redirect URI to match a registered one exactly, so
   * this is the value the README tells you to register. Taken from the
   * request rather than from a parameter: there is then nothing a crafted
   * link can redirect to, and a mismatched host fails at Google's end
   * anyway.
   */
  private static callbackUriFor(req: Request): string {
    return `${req.protocol}://${req.get('host')}/api/calendar/google/callback`
  }

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
  // --- google ----------------------------------------------------------------

  /** Whether Google can be used, and the state of each Google source. */
  @Get('google/status')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getGoogleStatus(): Promise<GoogleStatus> {
    return endpoints.googleStatus()
  }

  /**
   * The consent URL for connecting a source.
   *
   * The redirect URI is built from this request's own origin, so it is
   * whatever address the browser used to reach the dashboard — that is the
   * address to register in the Google Cloud console.
   */
  @Get('google/auth-url')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such calendar source')
  @Response(422, 'No Google OAuth client is configured')
  @NoCache()
  public async getGoogleAuthUrl(
    @Query('sourceId', true) sourceId: string,
    @Req() req: Request
  ): Promise<{ url: string }> {
    return endpoints.googleAuthUrl(sourceId, CalendarController.callbackUriFor(req))
  }

  /**
   * Where Google sends the browser back to.
   *
   * Answers with a redirect rather than JSON: a person is looking at this in
   * a browser, and the useful thing to do is put them back on the Settings
   * page with the outcome.
   */
  @Get('google/callback')
  @SuccessResponse(302, 'Redirects back to Settings')
  @NoCache()
  public async getGoogleCallback(
    @Res() res: ExpressResponse,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string
  ): Promise<void> {
    // Google reports a refused consent screen this way rather than by not
    // calling back at all.
    const result: GoogleCallbackResult = error
      ? { ok: false, message: `Google reported: ${error}` }
      : await endpoints.googleCallback(code, state)

    const query = new URLSearchParams({
      google: result.ok ? 'connected' : 'failed',
      message: result.message
    })

    res.redirect(302, `/settings?${query.toString()}`)
  }

  /** The calendars a connected source can see. */
  @Get('google/calendars')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such calendar source')
  @Response(422, 'That source is not connected')
  @NoCache()
  public async getGoogleCalendars(@Query('sourceId', true) sourceId: string): Promise<GoogleCalendarSummary[]> {
    return endpoints.googleCalendars(sourceId)
  }

  /** Forgets the stored Google tokens, leaving the source in place. */
  @Post('google/disconnect')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such calendar source')
  @NoCache()
  public async postGoogleDisconnect(@Query('sourceId', true) sourceId: string): Promise<CalendarSource> {
    return endpoints.googleDisconnect(sourceId)
  }

  // --- events ----------------------------------------------------------------

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

  /**
   * Deletes an event.
   *
   * For one occurrence of a repeating event, `scope=occurrence` (the default)
   * skips just that date and leaves the series running; `scope=series` removes
   * the whole thing. A one-off ignores the distinction.
   */
  @Delete('events/{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such event')
  @Response(409, 'Event comes from a subscribed calendar')
  @NoCache()
  public async deleteEvent(@Path('id') id: string, @Query('scope') scope?: string): Promise<void> {
    return endpoints.deleteEvent(id, scope === 'series' ? 'series' : 'occurrence')
  }
}
