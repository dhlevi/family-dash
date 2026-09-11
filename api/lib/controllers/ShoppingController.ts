import { Controller } from '../core/Controller'
import { Body, Delete, Get, NoCache, Patch, Path, Post, Response, Route, SuccessResponse } from '../core/Decorators'
import { ShoppingEndpoints, type ShoppingListSummary } from '../services/ShoppingEndpoints'
import type { ShoppingItem } from '../types/domain'

const endpoints = new ShoppingEndpoints()

/**
 * The shopping list: whatever the meal plan implies, plus whatever anyone
 * adds by hand.
 *
 * This is the one part of the app used away from the wall display.
 */
@Route('api/shopping')
export class ShoppingController extends Controller {
  public constructor() {
    super()
  }

  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getList(): Promise<ShoppingListSummary> {
    return endpoints.list()
  }

  /** The outstanding items as plain text, for copying or sharing. */
  @Get('text')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getText(): Promise<{ text: string }> {
    return endpoints.asText()
  }

  @Post('')
  @SuccessResponse(201, 'Created')
  @Response(422, 'Invalid item')
  @NoCache()
  public async postItem(@Body() body: unknown): Promise<ShoppingItem> {
    return endpoints.add(body)
  }

  /** Rebuild the meal-plan part of the list from what is planned in a range. */
  @Post('from-plan')
  @SuccessResponse(200, 'OK')
  @Response(422, 'Invalid range')
  @NoCache()
  public async postFromPlan(@Body() body: unknown): Promise<ShoppingListSummary> {
    return endpoints.generateFromPlan(body)
  }

  /** Remove everything already in the trolley. */
  @Delete('checked')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async deleteChecked(): Promise<{ removed: number }> {
    return endpoints.clearChecked()
  }

  @Patch('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such item')
  @NoCache()
  public async patchItem(@Path('id') id: string, @Body() body: unknown): Promise<ShoppingItem> {
    return endpoints.update(id, body)
  }

  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such item')
  @NoCache()
  public async deleteItem(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
