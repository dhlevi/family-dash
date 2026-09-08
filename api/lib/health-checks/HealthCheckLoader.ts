import { HealthValidator } from '../core/model/HealthValidator'
import { CalendarSourcesCheck } from './CalendarSourcesCheck'
import { DatabaseCheck } from './DatabaseCheck'
import { MediaCheck } from './MediaCheck'

/**
 * The probes /healthCheck runs. Add new ones here.
 */
export const healthValidators: HealthValidator[] = [new DatabaseCheck(), new MediaCheck(), new CalendarSourcesCheck()]
