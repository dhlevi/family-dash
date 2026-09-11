import { z } from 'zod'
import { ApiError } from '../core/model/ApiError'
import { PhotoRepository } from '../repositories/PhotoRepository'
import { ImageFile } from './ImageFile'
import { PhotoService, type ScanOutcome } from './PhotoService'
import type { Photo, PhotoAlbum } from '../types/domain'

const photos = new PhotoRepository()
const library = new PhotoService()

/**
 * Album names become folder names on the media volume, so they are kept to
 * the characters that behave on every filesystem a household might mount
 * including a Windows share, which rejects rather more than Linux does.
 */
const albumName = z
  .string()
  .trim()
  .max(60)
  .refine(value => !/[\\/:*?"<>|]/.test(value), 'An album name cannot contain \\ / : * ? " < > or |')
  .refine(value => value !== '.' && value !== '..', 'That is not a usable album name')

const photoUpdateSchema = z.object({
  favourite: z.boolean().optional(),
  album: albumName.optional()
})

export interface UploadedPhotoFile {
  originalname: string
  buffer: Buffer
  mimetype: string
  size: number
}

export interface UploadOutcome {
  added: Photo[]
  /** Files that were refused, with the reason, so the UI can say which. */
  rejected: Array<{ filename: string; reason: string }>
}

export class PhotoEndpoints {
  public async list(album?: string, favouritesOnly?: boolean, limit?: number, offset?: number): Promise<Photo[]> {
    return photos.list({ album, favouritesOnly, limit, offset })
  }

  public async albums(): Promise<PhotoAlbum[]> {
    return photos.albums()
  }

  public async byId(id: string): Promise<Photo> {
    const photo = await photos.byId(id)
    if (!photo) throw ApiError.notFound(`No photo with id '${id}'`)
    return photo
  }

  public async count(album?: string): Promise<{ total: number }> {
    return { total: await photos.count(album) }
  }

  /**
   * Accepts uploaded pictures.
   *
   * Each file is handled on its own: one unreadable file among twenty does
   * not fail the upload, it comes back in `rejected` so the page can say
   * which picture did not make it and keep the rest.
   */
  public async upload(files: UploadedPhotoFile[] | undefined, album?: unknown): Promise<UploadOutcome> {
    if (!files || files.length === 0) {
      throw ApiError.badRequest('No files were uploaded', { field: 'files' })
    }

    const parsedAlbum = albumName.optional().parse(album) ?? ''
    const outcome: UploadOutcome = { added: [], rejected: [] }

    for (const file of files) {
      if (!ImageFile.isSupported(file.originalname)) {
        outcome.rejected.push({
          filename: file.originalname,
          reason: `Only ${ImageFile.extensions().join(', ')} files can be added`
        })
        continue
      }

      try {
        outcome.added.push(await library.import({ album: parsedAlbum, filename: file.originalname, data: file.buffer }))
      } catch (error) {
        outcome.rejected.push({ filename: file.originalname, reason: (error as Error).message })
      }
    }

    if (outcome.added.length === 0) {
      throw ApiError.unprocessable('None of the uploaded files could be added', { rejected: outcome.rejected })
    }

    return outcome
  }

  public async update(id: string, body: unknown): Promise<Photo> {
    const parsed = photoUpdateSchema.parse(body)

    if (parsed.album !== undefined) {
      // Moving a photo between albums means moving the file, which the scan
      // would then see as a delete plus an add. Not worth the complication
      // for a wall display: albums are folders, and folders are managed
      // wherever the pictures are copied from.
      throw ApiError.unprocessable(
        'An album is a folder on the media volume. Move the file there and the next scan will follow it.',
        { field: 'album' }
      )
    }

    const updated = await photos.update(id, { favourite: parsed.favourite })
    if (!updated) throw ApiError.notFound(`No photo with id '${id}'`)

    return updated
  }

  /** Deletes the picture itself, not only the index row. */
  public async remove(id: string): Promise<void> {
    if (!(await library.remove(id))) throw ApiError.notFound(`No photo with id '${id}'`)
  }

  public async scan(): Promise<ScanOutcome> {
    return library.scan()
  }
}
