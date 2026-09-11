import { Controller } from '../core/Controller'
import { Get, NoCache, Route, SuccessResponse } from '../core/Decorators'
import { BinEndpoints } from '../services/BinEndpoints'
import { PeopleEndpoints } from '../services/PeopleEndpoints'
import type { BinOutlook, PersonDay } from '../types/domain'

const people = new PeopleEndpoints()
const bins = new BinEndpoints()

/**
 * The two views that are about the household rather than about one kind of
 * thing: who has what on today, and when the bins go out.
 *
 * Both read only the local cache — tasks written here, and calendar events the
 * background sync has already fetched — so the dashboard never waits on a
 * council's web server to draw itself.
 */
@Route('api/household')
export class HouseholdController extends Controller {
  public constructor() {
    super()
  }

  /** Everybody's day, one entry per name in the household roster. */
  @Get('people/today')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getPeopleToday(): Promise<PersonDay[]> {
    return people.today()
  }

  /** The next waste collection, and the one after it. */
  @Get('bins')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getBins(): Promise<BinOutlook> {
    return bins.outlook()
  }
}
