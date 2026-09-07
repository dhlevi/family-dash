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
import { RecipeEndpoints } from '../services/RecipeEndpoints'
import type { Recipe } from '../types/domain'

const endpoints = new RecipeEndpoints()

/**
 * The recipe library. Recipes are reusable: the meal planner references them
 * by id, so the same recipe can appear on as many days as you like.
 */
@Route('api/recipes')
export class RecipeController extends Controller {
  public constructor() {
    super()
  }

  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getRecipes(
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('favouritesOnly') favouritesOnly?: boolean,
    @Query('limit') limit?: number
  ): Promise<Recipe[]> {
    return endpoints.list(search, tag, favouritesOnly, limit)
  }

  /** Every tag in use, for the library's filter row. */
  @Get('tags')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getTags(): Promise<string[]> {
    return endpoints.tags()
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such recipe')
  @NoCache()
  public async getRecipe(@Path('id') id: string): Promise<Recipe> {
    return endpoints.byId(id)
  }

  /** The same recipe with quantities scaled to a different number of servings. */
  @Get('{id}/scaled')
  @SuccessResponse(200, 'OK')
  @Response(400, 'Recipe has no serving count to scale from')
  @Response(404, 'No such recipe')
  @NoCache()
  public async getScaled(@Path('id') id: string, @Query('servings', true) servings: number): Promise<Recipe> {
    return endpoints.scaled(id, servings)
  }

  @Post('')
  @SuccessResponse(201, 'Created')
  @Response(422, 'Invalid recipe')
  @NoCache()
  public async postRecipe(@Body() body: unknown): Promise<Recipe> {
    return endpoints.create(body)
  }

  @Patch('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such recipe')
  @Response(422, 'Invalid recipe')
  @NoCache()
  public async patchRecipe(@Path('id') id: string, @Body() body: unknown): Promise<Recipe> {
    return endpoints.update(id, body)
  }

  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such recipe')
  @NoCache()
  public async deleteRecipe(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
