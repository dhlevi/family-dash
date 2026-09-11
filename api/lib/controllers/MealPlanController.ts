import { Controller } from '../core/Controller'
import {
  Body,
  Delete,
  Get,
  NoCache,
  Path,
  Post,
  Put,
  Query,
  Response,
  Route,
  SuccessResponse
} from '../core/Decorators'
import { MealPlanEndpoints } from '../services/MealPlanEndpoints'
import type { MealPlanEntry } from '../types/domain'

const endpoints = new MealPlanEndpoints()

/**
 * What the household is eating, and when.
 *
 * A plan entry is a plain date plus a slot, never an instant.
 */
@Route('api/meals')
export class MealPlanController extends Controller {
  public constructor() {
    super()
  }

  /** Meals in a date range. Defaults to today. */
  @Get('plan')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Invalid range')
  @NoCache()
  public async getPlan(@Query('from') from?: string, @Query('to') to?: string): Promise<MealPlanEntry[]> {
    return endpoints.range(from, to)
  }

  /** What is planned for today, for the dashboard widget. */
  @Get('plan/today')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getToday(@Query('date') date?: string): Promise<MealPlanEntry[]> {
    return endpoints.today(date)
  }

  /** Set one date and slot. Replaces whatever was there. */
  @Put('plan')
  @SuccessResponse(200, 'OK')
  @Response(422, 'Invalid meal')
  @NoCache()
  public async putPlan(@Body() body: unknown): Promise<MealPlanEntry> {
    return endpoints.set(body)
  }

  /**
   * Copy a range of days forward by an offset.
   */
  @Post('plan/copy')
  @SuccessResponse(200, 'OK')
  @Response(422, 'Invalid range')
  @NoCache()
  public async postCopy(@Body() body: unknown): Promise<{ copied: number }> {
    return endpoints.copy(body)
  }

  /** Clear every meal in a range. */
  @Delete('plan')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Invalid range')
  @NoCache()
  public async deleteRange(@Query('from') from?: string, @Query('to') to?: string): Promise<{ cleared: number }> {
    return endpoints.clearRange(from, to)
  }

  @Delete('plan/{date}/{slot}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'Nothing planned for that slot')
  @NoCache()
  public async deleteSlot(@Path('date') date: string, @Path('slot') slot: string): Promise<void> {
    return endpoints.clearSlot(date, slot)
  }
}
