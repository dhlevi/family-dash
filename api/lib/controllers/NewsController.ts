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
import { NewsEndpoints } from '../services/NewsEndpoints'
import type { FetchOutcome } from '../services/NewsService'
import type { NewsArticle, NewsFeed } from '../types/domain'

const endpoints = new NewsEndpoints()

/**
 * Headlines, aggregated from RSS.
 *
 * There is no official Google News API and every paid aggregator wants an
 * account, but essentially every news organisation still publishes RSS for
 * free. Reads come from the local cache the background task fills, so the
 * page is instant and works when the network does not.
 */
@Route('api/news')
export class NewsController extends Controller {
  public constructor() {
    super()
  }

  /** Headlines, newest first. Count defaults to the Settings preference. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getArticles(
    @Query('feedId') feedId?: string,
    @Query('category') category?: string,
    @Query('withImagesOnly') withImagesOnly?: boolean,
    @Query('limit') limit?: number
  ): Promise<NewsArticle[]> {
    return endpoints.articles(feedId, category, withImagesOnly, limit)
  }

  @Get('feeds')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getFeeds(): Promise<NewsFeed[]> {
    return endpoints.feeds()
  }

  @Get('categories')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getCategories(): Promise<string[]> {
    return endpoints.categories()
  }

  /** Fetch every enabled feed now. */
  @Post('refresh')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async postRefresh(): Promise<FetchOutcome[]> {
    return endpoints.refreshAll()
  }

  /** Subscribe to a feed. The address is validated before it is saved. */
  @Post('feeds')
  @SuccessResponse(201, 'Created')
  @Response(409, 'Already subscribed')
  @Response(422, 'Feed could not be read')
  @NoCache()
  public async postFeed(@Body() body: unknown): Promise<NewsFeed> {
    return endpoints.addFeed(body)
  }

  @Patch('feeds/{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such feed')
  @Response(422, 'Feed could not be read')
  @NoCache()
  public async patchFeed(@Path('id') id: string, @Body() body: unknown): Promise<NewsFeed> {
    return endpoints.updateFeed(id, body)
  }

  @Delete('feeds/{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such feed')
  @NoCache()
  public async deleteFeed(@Path('id') id: string): Promise<void> {
    return endpoints.removeFeed(id)
  }

  @Post('feeds/{id}/refresh')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such feed')
  @NoCache()
  public async postFeedRefresh(@Path('id') id: string): Promise<FetchOutcome> {
    return endpoints.refreshFeed(id)
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such article')
  @NoCache()
  public async getArticle(@Path('id') id: string): Promise<NewsArticle> {
    return endpoints.article(id)
  }
}
