import * as fs from 'fs'
import * as path from 'path'
import { PhotoRepository, type PhotoUpdate } from '../repositories/PhotoRepository'
import { ImageFile } from './ImageFile'
import { MediaStore } from './MediaStore'
import type { Photo } from '../types/domain'

const photos = new PhotoRepository()

export interface ScanOutcome {
  added: number
  removed: number
  updated: number
  thumbnailed: number
  /** Files that looked like images but could not be read. */
  skipped: number
  /** Which ones, so the warning names something findable. Capped. */
  skippedFiles: string[]
  /**
   * True when the library looked empty but the index was not, so nothing was
   * removed. Almost always an unmounted volume.
   */
  libraryMissing: boolean
  durationMs: number
}

export interface ImportRequest {
  album: string
  filename: string
  data: Buffer
}

/**
 * Keeps the `photo` index in step with the media volume.
 *
 * The library is a plain folder, so it is not only the app that changes it —
 * pictures also arrive by copying them onto the volume from a laptop or a
 * card reader. Everything about the index is therefore derived from what is
 * actually on disk, and the scan is safe to run repeatedly.
 *
 * Album is the immediate subfolder name. Deeper nesting is flattened onto
 * the top-level folder rather than ignored, so dropping in a folder tree
 * from a camera still produces something browsable.
 */
export class PhotoService {
  /** How deep to walk. Enough for `album/year/file` without risking a runaway. */
  private static readonly MAX_DEPTH = 6

  /** How many unreadable filenames to name in the outcome. */
  private static readonly MAX_REPORTED_SKIPS = 20

  /** Directories a media volume tends to accumulate that hold nothing to show. */
  private static readonly IGNORED_DIRECTORIES = new Set([
    '.git',
    '@eaDir',
    '.thumbnails',
    '.Trashes',
    '.Spotlight-V100',
    '#recycle',
    'lost+found'
  ])

  /**
   * Indexes new files, forgets deleted ones, and fills in missing
   * thumbnails.
   *
   * Deliberately not transactional. A scan of a few thousand photos does
   * real work per file, and holding one transaction open across all of it
   * would block writes from the rest of the app for the duration. Each file
   * is independent, so a scan interrupted half way leaves a correct index of
   * what it managed to reach and the next run picks up the rest.
   */
  public async scan(): Promise<ScanOutcome> {
    const startedAt = Date.now()
    const outcome: ScanOutcome = {
      added: 0,
      removed: 0,
      updated: 0,
      thumbnailed: 0,
      skipped: 0,
      skippedFiles: [],
      libraryMissing: false,
      durationMs: 0
    }

    await MediaStore.ensureDirectories()

    const indexed = await photos.allRelPaths()
    const onDisk = await this.walk()

    /**
     * An empty library where the index is not is treated as a missing volume,
     * not as a library somebody emptied.
     *
     * The distinction matters because reconciling would delete every row —
     * and `recipe.photo_id` references those rows with ON DELETE SET NULL,
     * so an unplugged USB drive would quietly clear the picture off every
     * recipe. Plugging it back in re-indexes the photos under new ids, which
     * would not put them back. Nothing is deleted in this state; the next
     * scan with the volume present reconciles normally.
     */
    if (onDisk.length === 0 && indexed.size > 0) {
      outcome.libraryMissing = true
      outcome.durationMs = Date.now() - startedAt

      console.warn(
        `Photo scan found no files but the index holds ${indexed.size}; ` +
          'treating the media volume as unavailable and leaving the index alone'
      )

      return outcome
    }

    for (const file of onDisk) {
      const existing = indexed.get(file.relPath)

      if (existing) {
        indexed.delete(file.relPath)
        if (await this.refresh(file, existing, outcome)) outcome.updated += 1
        continue
      }

      const added = await this.index(file)
      if (!added) {
        outcome.skipped += 1
        if (outcome.skippedFiles.length < PhotoService.MAX_REPORTED_SKIPS) {
          outcome.skippedFiles.push(file.relPath)
        }
        continue
      }

      outcome.added += 1
      if (added.thumbnailed) outcome.thumbnailed += 1
    }

    // Whatever is left in the map has no file behind it any more.
    const orphaned = [...indexed.keys()]
    if (orphaned.length > 0) {
      outcome.removed = await photos.removeByRelPaths(orphaned)

      // The thumbnails of removed photos are no use to anyone.
      await Promise.all(
        [...indexed.values()].map(row =>
          row.thumbPath
            ? fs.promises
                .rm(MediaStore.resolveWithin(MediaStore.thumbsDir(), row.thumbPath) ?? '', { force: true })
                .catch(() => undefined)
            : Promise.resolve()
        )
      )
    }

    outcome.durationMs = Date.now() - startedAt

    console.info(
      `Photo scan: +${outcome.added} -${outcome.removed} ~${outcome.updated} ` +
        `(${outcome.skipped} unreadable) in ${outcome.durationMs}ms`
    )

    return outcome
  }

  /** Saves an uploaded picture into the library and indexes it. */
  public async import(request: ImportRequest): Promise<Photo> {
    const extension = path.extname(request.filename).toLowerCase()
    const filename = MediaStore.safeFilename(request.filename, extension)

    const relPath = await MediaStore.writePhoto(request.album, filename, request.data)

    const indexed = await this.index({
      relPath,
      album: request.album,
      filename: path.basename(relPath),
      sizeBytes: request.data.length
    })

    if (!indexed) {
      // Not a readable image after all: take the file back out rather than
      // leaving something in the library that will never be shown.
      await MediaStore.removePhoto(relPath, null)
      throw new Error(`'${request.filename}' could not be read as an image`)
    }

    return indexed.photo
  }

  /** Removes a photo from the index and from disk. Returns false if unknown. */
  public async remove(id: string): Promise<boolean> {
    const file = await photos.fileFor(id)
    if (!file) return false

    await photos.remove(id)
    await MediaStore.removePhoto(file.relPath, file.thumbPath)
    return true
  }

  // --- internals -----------------------------------------------------------

  private async index(file: LibraryFile): Promise<{ photo: Photo; thumbnailed: boolean } | null> {
    const absolute = MediaStore.resolveWithin(MediaStore.photosDir(), file.relPath)
    if (!absolute) return null

    const facts = await ImageFile.inspect(absolute)
    if (facts.width === null || facts.height === null) return null

    const thumbRelPath = await this.thumbnail(file.relPath, absolute)

    const photo = await photos.create({
      relPath: file.relPath,
      album: file.album,
      filename: file.filename,
      mimeType: ImageFile.mimeTypeFor(file.filename),
      width: facts.width,
      height: facts.height,
      sizeBytes: file.sizeBytes ?? null,
      // Falling back to the file's own date keeps the library in a sensible
      // order when a picture has no EXIF at all — screenshots, downloads,
      // anything that has been through a messaging app.
      takenAt: facts.takenAt ?? file.modifiedAt ?? null,
      thumbPath: thumbRelPath
    })

    return { photo, thumbnailed: thumbRelPath !== null }
  }

  /**
   * Re-reads a photo whose file has changed, and replaces a thumbnail that
   * has gone missing. Returns whether anything was written.
   */
  private async refresh(
    file: LibraryFile,
    existing: { id: string; thumbPath: string | null; sizeBytes: number | null },
    outcome: ScanOutcome
  ): Promise<boolean> {
    const absolute = MediaStore.resolveWithin(MediaStore.photosDir(), file.relPath)
    if (!absolute) return false

    const thumbRelPath = MediaStore.thumbRelPathFor(file.relPath)
    const thumbMissing = (await MediaStore.thumbPath(thumbRelPath)) === null

    // Size is the cheap signal that a file was replaced in place. Re-reading
    // every photo on every hourly scan would cost far more than it finds.
    const replaced = file.sizeBytes !== undefined && file.sizeBytes !== existing.sizeBytes

    if (!thumbMissing && !replaced) return false

    // A replaced file needs a new thumbnail even though one exists, because
    // the one on disk is of the picture that used to be there.
    if (await this.thumbnail(file.relPath, absolute)) outcome.thumbnailed += 1

    const changes: PhotoUpdate = { thumbPath: thumbRelPath }

    if (replaced) {
      const facts = await ImageFile.inspect(absolute)
      changes.width = facts.width
      changes.height = facts.height
      changes.sizeBytes = file.sizeBytes ?? null
      changes.takenAt = facts.takenAt ?? file.modifiedAt ?? null
    }

    await photos.update(existing.id, changes)
    return true
  }

  private async thumbnail(relPath: string, absoluteSource: string): Promise<string | null> {
    const thumbRelPath = MediaStore.thumbRelPathFor(relPath)
    const destination = MediaStore.resolveWithin(MediaStore.thumbsDir(), thumbRelPath)
    if (!destination) return null

    return (await ImageFile.writeThumbnail(absoluteSource, destination)) ? thumbRelPath : null
  }

  /** Every supported image under the photos directory. */
  private async walk(): Promise<LibraryFile[]> {
    const found: LibraryFile[] = []
    const photosDir = MediaStore.photosDir()

    const descend = async (directory: string, album: string, depth: number): Promise<void> => {
      if (depth > PhotoService.MAX_DEPTH) return

      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true })
      } catch (error) {
        console.warn(`Photo scan could not read ${directory}: ${(error as Error).message}`)
        return
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const absolute = path.join(directory, entry.name)

        if (entry.isDirectory()) {
          if (PhotoService.IGNORED_DIRECTORIES.has(entry.name)) continue
          // The album is the top-level folder; anything deeper belongs to it.
          await descend(absolute, album.length > 0 ? album : entry.name, depth + 1)
          continue
        }

        // Symlinked files are followed only if they stay inside the library.
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        if (!ImageFile.isSupported(entry.name)) continue

        const relPath = path.relative(photosDir, absolute)
        if (entry.isSymbolicLink() && (await MediaStore.photoPath(relPath)) === null) continue

        let stats: fs.Stats
        try {
          stats = await fs.promises.stat(absolute)
        } catch {
          continue
        }

        found.push({
          relPath,
          album,
          filename: entry.name,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime
        })
      }
    }

    await descend(photosDir, '', 0)
    return found
  }
}

interface LibraryFile {
  relPath: string
  album: string
  filename: string
  sizeBytes?: number
  modifiedAt?: Date
}
