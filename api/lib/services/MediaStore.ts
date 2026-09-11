import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { AppProperties } from '../core/AppProperties'

/**
 * The layout of the mounted media volume, and the only place that turns a
 * name into a filesystem path.
 *
 * Photos are served by database id rather than by path (see MediaController),
 * so no caller-supplied path ever reaches this module from a request. The
 * containment checks here are still worth having: the library is a folder a
 * person fills by hand, possibly over a network share, and a stray symlink
 * or an odd filename should be skipped rather than followed out of the tree.
 */
export class MediaStore {
  private constructor() {
    /* static only */
  }

  public static root(): string {
    return AppProperties.getString('media.root', '/media')
  }

  public static photosDir(): string {
    return path.join(MediaStore.root(), AppProperties.getString('media.photos.dir', 'photos'))
  }

  public static thumbsDir(): string {
    return path.join(MediaStore.root(), AppProperties.getString('media.thumbs.dir', 'thumbs'))
  }

  /**
   * Generated map artwork for the screensaver.
   *
   * Kept apart from the photo library on purpose: the library is a folder a
   * person curates, and a background task quietly writing pictures into it —
   * and pruning them again — would be an unpleasant surprise. Everything here
   * is disposable and regenerated from the city list.
   */
  public static cityArtDir(): string {
    return path.join(MediaStore.root(), AppProperties.getString('media.cityart.dir', 'cityart'))
  }

  /** Creates the library directories if the volume is mounted but empty. */
  public static async ensureDirectories(): Promise<void> {
    for (const directory of [MediaStore.photosDir(), MediaStore.thumbsDir(), MediaStore.cityArtDir()]) {
      await fs.promises.mkdir(directory, { recursive: true })
    }
  }

  /**
   * Joins `relative` onto `base`, or returns null if the result would sit
   * outside it. Purely lexical, so it is safe to call for a path that does
   * not exist yet.
   */
  public static resolveWithin(base: string, relative: string): string | null {
    if (relative.length === 0 || path.isAbsolute(relative)) return null

    const resolvedBase = path.resolve(base)
    const resolved = path.resolve(resolvedBase, relative)

    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) return null

    return resolved
  }

  /**
   * As `resolveWithin`, but also follows symlinks and confirms the real file
   * is inside the real base. Used before opening a file, where a link
   * pointing out of the library would otherwise be served.
   */
  public static async resolveExistingWithin(base: string, relative: string): Promise<string | null> {
    const candidate = MediaStore.resolveWithin(base, relative)
    if (!candidate) return null

    try {
      const [realBase, realPath] = await Promise.all([fs.promises.realpath(base), fs.promises.realpath(candidate)])

      if (realPath !== realBase && !realPath.startsWith(realBase + path.sep)) return null

      const stats = await fs.promises.stat(realPath)
      return stats.isFile() ? realPath : null
    } catch {
      // Missing, unreadable, or a broken link: all "no file here".
      return null
    }
  }

  public static photoPath(relPath: string): Promise<string | null> {
    return MediaStore.resolveExistingWithin(MediaStore.photosDir(), relPath)
  }

  public static cityArtPath(relPath: string): Promise<string | null> {
    return MediaStore.resolveExistingWithin(MediaStore.cityArtDir(), relPath)
  }

  public static thumbPath(relPath: string): Promise<string | null> {
    return MediaStore.resolveExistingWithin(MediaStore.thumbsDir(), relPath)
  }

  /**
   * The thumbnail name for a photo: a hash of its library path.
   *
   * Derived rather than stored-then-generated so a rescan finds the existing
   * thumbnail instead of making a second one, and hashed rather than built
   * from the filename so that no album or file name can produce a collision
   * or an awkward character on disk.
   */
  public static thumbRelPathFor(relPath: string): string {
    return `${crypto.createHash('sha1').update(relPath).digest('hex')}.webp`
  }

  /**
   * The name of the browser-displayable copy of a photo, for the formats
   * that need one. Lives beside the thumbnails, since it is the same kind of
   * thing: a derivative that can be deleted and regenerated at any time.
   */
  public static displayRelPathFor(relPath: string): string {
    return `${crypto.createHash('sha1').update(relPath).digest('hex')}-display.webp`
  }

  /**
   * A filename that is safe on disk and unlikely to collide.
   *
   * Uploads arrive with whatever name the phone or camera gave them, which
   * may contain path separators, spaces, or characters a network share will
   * not accept. The extension is kept because the scanner and the browser
   * both use it.
   */
  public static safeFilename(original: string, extension: string): string {
    const stem = path
      .basename(original, path.extname(original))
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60)

    const base = stem.length > 0 ? stem : 'photo'

    return `${base}${extension}`
  }

  /**
   * Writes an uploaded photo into an album, returning its library path.
   *
   * Never overwrites: a second `holiday.jpg` becomes `holiday-2.jpg`. Two
   * people uploading from their phones on the same evening should not be
   * able to replace each other's pictures.
   */
  public static async writePhoto(album: string, filename: string, data: Buffer): Promise<string> {
    const albumDirectory = album.length > 0 ? MediaStore.resolveWithin(MediaStore.photosDir(), album) : null
    if (album.length > 0 && !albumDirectory) throw new Error(`Album name '${album}' is not usable as a folder`)

    const directory = albumDirectory ?? MediaStore.photosDir()
    await fs.promises.mkdir(directory, { recursive: true })

    const extension = path.extname(filename)
    const stem = path.basename(filename, extension)

    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = attempt === 0 ? filename : `${stem}-${attempt + 1}${extension}`
      const absolute = path.join(directory, candidate)

      try {
        // 'wx' fails if the file exists, so the check and the write are one
        // atomic step rather than a race between them.
        await fs.promises.writeFile(absolute, data, { flag: 'wx' })
        return path.relative(MediaStore.photosDir(), absolute)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }

    throw new Error(`Could not find an unused name for '${filename}' in album '${album || 'the library'}'`)
  }

  /**
   * The small version of a generated artwork.
   *
   * Derived from the id rather than stored, in the same way thumbnail names
   * are derived from a photo's path, so it can be found without a column to
   * record it and regenerated at any time.
   */
  public static cityArtThumbName(id: string): string {
    return `${id}-thumb.webp`
  }

  /**
   * Writes one generated artwork file, replacing any previous version.
   *
   * Unlike an uploaded photo this *may* overwrite: the name is a generated id
   * rather than something a person chose, so a collision means the same
   * artwork being rewritten, not two people's pictures competing.
   */
  public static async writeCityArt(filename: string, data: Buffer | string): Promise<string> {
    const absolute = MediaStore.resolveWithin(MediaStore.cityArtDir(), filename)
    if (!absolute) throw new Error(`Refusing to write city art outside the media volume: '${filename}'`)

    await fs.promises.mkdir(MediaStore.cityArtDir(), { recursive: true })
    await fs.promises.writeFile(absolute, data)

    return filename
  }

  /** Removes generated artwork files, ignoring any that have gone already. */
  public static async removeCityArt(...relPaths: Array<string | null>): Promise<void> {
    for (const relPath of relPaths) {
      if (!relPath) continue

      const absolute = MediaStore.resolveWithin(MediaStore.cityArtDir(), relPath)
      if (absolute) await fs.promises.rm(absolute, { force: true })
    }
  }

  /** Removes a photo and its thumbnail, ignoring either being gone already. */
  public static async removePhoto(relPath: string, thumbRelPath: string | null): Promise<void> {
    const photo = MediaStore.resolveWithin(MediaStore.photosDir(), relPath)
    if (photo) await fs.promises.rm(photo, { force: true })

    if (thumbRelPath) {
      const thumb = MediaStore.resolveWithin(MediaStore.thumbsDir(), thumbRelPath)
      if (thumb) await fs.promises.rm(thumb, { force: true })
    }

    // The display copy is derived from the library path, so it can be found
    // without having been recorded anywhere.
    const display = MediaStore.resolveWithin(MediaStore.thumbsDir(), MediaStore.displayRelPathFor(relPath))
    if (display) await fs.promises.rm(display, { force: true })
  }
}
