import * as fs from 'fs'
import * as path from 'path'
import { AppProperties } from '../core/AppProperties'
import { HealthResult, HealthValidator } from '../core/model/HealthValidator'

/**
 * Non-critical probe: is the media volume mounted and writable?
 *
 * Photos and drawing thumbnails live on a mounted volume that could be a USB
 * stick or a network share. If it vanishes, the rest of the dashboard should
 * carry on working — hence non-critical — but the reason the Pictures page is
 * empty should be visible somewhere.
 */
export class MediaCheck implements HealthValidator {
  public readonly name = 'media'
  public readonly critical = false

  public async validate(): Promise<HealthResult> {
    const root = AppProperties.getString('media.root', '/media')

    if (!fs.existsSync(root)) {
      return { healthy: false, message: `Media root '${root}' does not exist`, detail: { root } }
    }

    const subdirectories = ['photos.dir', 'thumbs.dir', 'drawings.dir'].map(key =>
      path.join(root, AppProperties.getString(key, key.replace('.dir', '')))
    )

    const missing = subdirectories.filter(directory => !fs.existsSync(directory))

    try {
      await fs.promises.access(root, fs.constants.W_OK)
    } catch {
      return { healthy: false, message: `Media root '${root}' is not writable`, detail: { root } }
    }

    return {
      healthy: missing.length === 0,
      message: missing.length > 0 ? `Missing media subdirectories: ${missing.join(', ')}` : undefined,
      detail: { root, subdirectories }
    }
  }
}
