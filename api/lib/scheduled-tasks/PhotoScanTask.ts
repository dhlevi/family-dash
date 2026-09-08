import { AppProperties } from '../core/AppProperties'
import { PhotoService } from '../services/PhotoService'
import type { Task } from '../core/model/Task'

const library = new PhotoService()

/**
 * Keeps the photo index in step with the media volume.
 *
 * Pictures do not only arrive through the upload button — the library is a
 * plain folder that someone can copy a card reader's worth of holiday photos
 * onto, and this is what notices. Hourly by default: often enough that a
 * folder dropped on the share turns up without anyone thinking about it,
 * rarely enough that a Pi is not forever walking the library.
 *
 * Runs on startup too, so a volume that was swapped while the Pi was off is
 * reflected by the time anyone looks at the screen.
 */
export const photoScanTask: Task = {
  name: 'photo-scan',
  get cron() {
    return AppProperties.getString('tasks.photos.scan.cron', '0 * * * *')
  },
  enabled: true,
  runOnStartup: true,
  async execute() {
    const outcome = await library.scan()

    // A few unreadable files is normal — a hand-filled library collects the
    // odd truncated download — so those are logged rather than failed. They
    // are also skipped by every future scan, never having been indexed, so
    // failing on them would leave this task permanently red and its status
    // worth nothing.
    if (outcome.skipped > 0) {
      console.warn(
        `Photo scan skipped ${outcome.skipped} unreadable file(s): ${outcome.skippedFiles.join(', ')}` +
          (outcome.skipped > outcome.skippedFiles.length ? ', …' : '')
      )
    }

    // A vanished volume is the one thing here worth failing on: the library
    // is not going to come back on its own, and until it does the Pictures
    // page is showing an index of files nobody can open.
    if (outcome.libraryMissing) {
      throw new Error(
        'The photo library appears to be empty while the index is not. The media volume is probably not mounted; ' +
          'the index has been left alone so the pictures come back when it is.'
      )
    }
  }
}
