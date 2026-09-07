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
import { TaskItemEndpoints, type TaskCompletion, type TaskSummary } from '../services/TaskItemEndpoints'
import type { TaskItem } from '../types/domain'

const endpoints = new TaskItemEndpoints()

/**
 * Tasks and chores.
 *
 * The household is shared, so `assignee` is free text rather than a
 * reference to a user record.
 */
@Route('api/tasks')
export class TaskController extends Controller {
  public constructor() {
    super()
  }

  /** Tasks matching the given filters. Open tasks only, unless asked otherwise. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getTasks(
    @Query('includeCompleted') includeCompleted?: boolean,
    @Query('assignee') assignee?: string,
    @Query('category') category?: string,
    @Query('dueBefore') dueBefore?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: number
  ): Promise<TaskItem[]> {
    return endpoints.list(includeCompleted, assignee, category, dueBefore, search, limit)
  }

  /** Open, due-soon and overdue counts, for the dashboard badge. */
  @Get('summary')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getSummary(@Query('dueBefore') dueBefore?: string): Promise<TaskSummary> {
    return endpoints.summary(dueBefore)
  }

  /** Assignee and category names already in use, to offer as suggestions. */
  @Get('suggestions')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getSuggestions(): Promise<{ assignees: string[]; categories: string[] }> {
    return endpoints.suggestions()
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such task')
  @NoCache()
  public async getTask(@Path('id') id: string): Promise<TaskItem> {
    return endpoints.byId(id)
  }

  @Post('')
  @SuccessResponse(201, 'Created')
  @Response(422, 'Invalid task')
  @NoCache()
  public async postTask(@Body() body: unknown): Promise<TaskItem> {
    return endpoints.create(body)
  }

  @Patch('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such task')
  @Response(422, 'Invalid task')
  @NoCache()
  public async patchTask(@Path('id') id: string, @Body() body: unknown): Promise<TaskItem> {
    return endpoints.update(id, body)
  }

  /**
   * Tick a task off. A repeating task also gets its next occurrence, which
   * comes back as `next`.
   */
  @Post('{id}/complete')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such task')
  @NoCache()
  public async postComplete(@Path('id') id: string): Promise<TaskCompletion> {
    return endpoints.complete(id)
  }

  @Post('{id}/reopen')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such task')
  @NoCache()
  public async postReopen(@Path('id') id: string): Promise<TaskItem> {
    return endpoints.reopen(id)
  }

  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such task')
  @NoCache()
  public async deleteTask(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
