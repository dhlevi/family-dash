import { AppProperties } from '../core/AppProperties'
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
  SuccessResponse,
  UploadArray,
  UploadedFiles
} from '../core/Decorators'
import { PhotoEndpoints, type UploadOutcome, type UploadedPhotoFile } from '../services/PhotoEndpoints'
import type { ScanOutcome } from '../services/PhotoService'
import type { Photo, PhotoAlbum } from '../types/domain'

const endpoints = new PhotoEndpoints()

/**
 * The photo library index.
 *
 * The pictures themselves are served by MediaController; this is the
 * catalogue. Google Photos is not an option — the Library API's read scopes
 * were withdrawn in 2025 and an app can now only see media it uploaded
 * itself — so the library is a folder on the mounted volume, filled either
 * by uploading here or by copying files onto it directly.
 */

/**
 * How many pictures one upload may carry. A phone's share sheet will happily
 * send a whole album, and each file is held in memory while it is inspected.
 */
const MAX_UPLOAD_FILES = 25

/**
 * Per-file size limit, from `media.upload.maxBytes`.
 *
 * Passed as a function: decorators run when this module is imported, which
 * is before application.properties has been read, so reading the property
 * here directly would always give the default.
 */
const uploadLimits = () => ({
  limits: {
    fileSize: AppProperties.getNumber('media.upload.maxBytes', 25 * 1024 * 1024),
    files: MAX_UPLOAD_FILES
  }
})

@Route('api/photos')
export class PhotoController extends Controller {
  public constructor() {
    super()
  }

  /** Albums with their sizes and a cover photo. */
  @Get('albums')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getAlbums(): Promise<PhotoAlbum[]> {
    return endpoints.albums()
  }

  @Get('count')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getCount(@Query('album') album?: string): Promise<{ total: number }> {
    return endpoints.count(album)
  }

  /**
   * Adds pictures to the library.
   *
   * Multipart, field name `files`. `album` is an optional text field in the
   * same form; a picture with no album sits at the top of the library.
   */
  @Post('')
  @UploadArray('files', MAX_UPLOAD_FILES, uploadLimits)
  @SuccessResponse(201, 'Created')
  @Response(400, 'No files in the request')
  @Response(422, 'None of the files could be added')
  @NoCache()
  public async postPhotos(
    @UploadedFiles() files: UploadedPhotoFile[] | undefined,
    @Body(false) body?: unknown
  ): Promise<UploadOutcome> {
    return endpoints.upload(files, (body as { album?: unknown } | undefined)?.album)
  }

  /** Reconcile the index with the media volume now. */
  @Post('scan')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async postScan(): Promise<ScanOutcome> {
    return endpoints.scan()
  }

  /** Newest first. Omit `album` for the whole library, or pass '' for loose files. */
  @Get('')
  @SuccessResponse(200, 'OK')
  @NoCache()
  public async getPhotos(
    @Query('album') album?: string,
    @Query('favouritesOnly') favouritesOnly?: boolean,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ): Promise<Photo[]> {
    return endpoints.list(album, favouritesOnly, limit, offset)
  }

  @Get('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such photo')
  @NoCache()
  public async getPhoto(@Path('id') id: string): Promise<Photo> {
    return endpoints.byId(id)
  }

  /** Mark or unmark a favourite. */
  @Patch('{id}')
  @SuccessResponse(200, 'OK')
  @Response(404, 'No such photo')
  @NoCache()
  public async patchPhoto(@Path('id') id: string, @Body() body: unknown): Promise<Photo> {
    return endpoints.update(id, body)
  }

  /** Deletes the file from the media volume as well as the index. */
  @Delete('{id}')
  @SuccessResponse(204, 'Deleted')
  @Response(404, 'No such photo')
  @NoCache()
  public async deletePhoto(@Path('id') id: string): Promise<void> {
    return endpoints.remove(id)
  }
}
