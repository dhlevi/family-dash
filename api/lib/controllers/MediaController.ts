import type { Response } from 'express'
import { Controller } from '../core/Controller'
import { Get, Path, Res, Response as ResponseCode, Route, SuccessResponse } from '../core/Decorators'
import { ApiError } from '../core/model/ApiError'
import { CityArtRepository } from '../repositories/CityArtRepository'
import { PhotoRepository } from '../repositories/PhotoRepository'
import { ImageFile } from '../services/ImageFile'
import { MediaStore } from '../services/MediaStore'

const photos = new PhotoRepository()
const cityArt = new CityArtRepository()

/**
 * Serves the image files themselves.
 *
 * Addressed by database id rather than by path. That is the whole reason
 * there is no path-traversal surface here: a request cannot name a file, it
 * can only name a row, and the path comes from the row. `nginx` proxies
 * `/media/` here and caches the result.
 *
 * Kept apart from PhotoController because these are the only routes in the
 * application that answer with something other than JSON.
 */
@Route('media')
export class MediaController extends Controller {
  /**
   * How long a browser may keep an image.
   *
   * A year is safe because the URLs the API hands out carry the row's
   * `updated_at` as a version, so a picture that is replaced on disk is
   * requested under a different URL.
   */
  private static readonly CACHE_SECONDS = 31_536_000

  public constructor() {
    super()
  }

  /** The full-size picture. */
  @Get('photos/{id}')
  @SuccessResponse(200, 'The image file')
  @ResponseCode(404, 'No such photo, or its file has gone')
  public async getPhoto(@Path('id') id: string, @Res() res: Response): Promise<void> {
    const photo = await photos.fileFor(id)
    if (!photo) throw ApiError.notFound(`No photo with id '${id}'`)

    const absolute = await MediaStore.photoPath(photo.relPath)
    if (!absolute) {
      // Indexed but no longer on the volume: the next scan will drop the row.
      throw ApiError.notFound(`The file for photo '${id}' is not on the media volume`)
    }

    if (ImageFile.isBrowserRenderable(photo.mimeType)) {
      await MediaController.sendFile(res, absolute, photo.mimeType ?? 'application/octet-stream', photo.filename)
      return
    }

    // A HEIC. No browser can show one, so what gets served is a converted
    // copy, made the first time somebody actually opens the picture and kept
    // afterwards. Doing it on demand rather than during the scan means a
    // library full of phone photos costs nothing until they are looked at.
    const display = await MediaController.displayCopy(photo.relPath, absolute)
    if (!display) {
      throw ApiError.unavailable(
        `Photo '${id}' is in a format this browser cannot show and a viewable copy could not be made`
      )
    }

    await MediaController.sendFile(res, display, 'image/webp', photo.filename)
  }

  /** The cached browser-displayable copy of a photo, generating it if absent. */
  private static async displayCopy(relPath: string, absoluteSource: string): Promise<string | null> {
    const displayRelPath = MediaStore.displayRelPathFor(relPath)

    const existing = await MediaStore.thumbPath(displayRelPath)
    if (existing) return existing

    const destination = MediaStore.resolveWithin(MediaStore.thumbsDir(), displayRelPath)
    if (!destination) return null

    if (!(await ImageFile.writeDisplayCopy(absoluteSource, destination))) return null

    return MediaStore.thumbPath(displayRelPath)
  }

  /**
   * The small version.
   *
   * Falls back to the original when there is no thumbnail, so a tile always
   * shows something — except for a HEIC, which no browser can display: for
   * those the thumbnail is the only viewable form, and its absence is a 404
   * the page handles rather than a broken image the browser cannot explain.
   */
  @Get('thumbs/{id}')
  @SuccessResponse(200, 'The thumbnail, or the original if there is none')
  @ResponseCode(404, 'No such photo, or nothing viewable for it')
  public async getThumbnail(@Path('id') id: string, @Res() res: Response): Promise<void> {
    const photo = await photos.fileFor(id)
    if (!photo) throw ApiError.notFound(`No photo with id '${id}'`)

    const thumbnail = photo.thumbPath === null ? null : await MediaStore.thumbPath(photo.thumbPath)
    if (thumbnail) {
      await MediaController.sendFile(res, thumbnail, 'image/webp', photo.filename)
      return
    }

    if (!ImageFile.isBrowserRenderable(photo.mimeType)) {
      throw ApiError.notFound(`Photo '${id}' has no thumbnail and its format cannot be shown by a browser`)
    }

    const original = await MediaStore.photoPath(photo.relPath)
    if (!original) throw ApiError.notFound(`The file for photo '${id}' is not on the media volume`)

    await MediaController.sendFile(res, original, photo.mimeType ?? 'application/octet-stream', photo.filename)
  }

  /**
   * A generated map artwork, as the raster the screensaver loads.
   *
   * Falls back to the SVG when there is no raster — which happens only if
   * `sharp` could not rasterise it — so the picture still appears rather than
   * leaving a gap in the rotation.
   */
  @Get('city-art/{id}')
  @SuccessResponse(200, 'The artwork')
  @ResponseCode(404, 'No such artwork, or its file has gone')
  public async getCityArt(@Path('id') id: string, @Res() res: Response): Promise<void> {
    const art = await cityArt.fileFor(id)
    if (!art) throw ApiError.notFound(`No map artwork with id '${id}'`)

    if (art.rasterPath) {
      const raster = await MediaStore.cityArtPath(art.rasterPath)
      if (raster) {
        await MediaController.sendFile(res, raster, 'image/webp', `${art.cityName}.webp`)
        return
      }
    }

    const svg = await MediaStore.cityArtPath(art.svgPath)
    if (!svg) throw ApiError.notFound(`The files for map artwork '${id}' are not on the media volume`)

    await MediaController.sendFile(res, svg, 'image/svg+xml', `${art.cityName}.svg`)
  }

  /**
   * The small version, for the grid on the Settings page.
   *
   * Made on demand the first time somebody looks at that page and kept
   * afterwards, rather than during generation — the same bargain the photo
   * library's display copies make. Worth having because the full artwork is
   * around a megabyte, and a dozen of them behind 200-pixel tiles is twelve
   * megabytes for a page that only needs to show what each one looks like.
   */
  @Get('city-art/{id}/thumb')
  @SuccessResponse(200, 'The small version')
  @ResponseCode(404, 'No such artwork, or its file has gone')
  public async getCityArtThumb(@Path('id') id: string, @Res() res: Response): Promise<void> {
    const art = await cityArt.fileFor(id)
    if (!art) throw ApiError.notFound(`No map artwork with id '${id}'`)

    const thumbName = MediaStore.cityArtThumbName(id)
    const existing = await MediaStore.cityArtPath(thumbName)

    if (existing) {
      await MediaController.sendFile(res, existing, 'image/webp', `${art.cityName}.webp`)
      return
    }

    // Built from the vector master rather than the raster, so the small
    // version is resampled from the source instead of from a compressed copy.
    const source = await MediaStore.cityArtPath(art.svgPath)
    if (!source) throw ApiError.notFound(`The file for map artwork '${id}' is not on the media volume`)

    const thumbnail = await ImageFile.renderCityArtThumbnail(source)
    if (!thumbnail) throw ApiError.unavailable(`A small version of map artwork '${id}' could not be made`)

    await MediaStore.writeCityArt(thumbName, thumbnail)
    const written = await MediaStore.cityArtPath(thumbName)
    if (!written) throw ApiError.unavailable(`A small version of map artwork '${id}' could not be stored`)

    await MediaController.sendFile(res, written, 'image/webp', `${art.cityName}.webp`)
  }

  /**
   * The vector master.
   *
   * Resolution independent, and the form to print or take somewhere else —
   * which is the main reason both are kept rather than only the raster.
   */
  @Get('city-art/{id}/svg')
  @SuccessResponse(200, 'The artwork as SVG')
  @ResponseCode(404, 'No such artwork, or its file has gone')
  public async getCityArtSvg(@Path('id') id: string, @Res() res: Response): Promise<void> {
    const art = await cityArt.fileFor(id)
    if (!art) throw ApiError.notFound(`No map artwork with id '${id}'`)

    const svg = await MediaStore.cityArtPath(art.svgPath)
    if (!svg) throw ApiError.notFound(`The file for map artwork '${id}' is not on the media volume`)

    await MediaController.sendFile(res, svg, 'image/svg+xml', `${art.cityName}.svg`)
  }

  private static sendFile(res: Response, absolutePath: string, contentType: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      res.type(contentType)
      res.setHeader('Cache-Control', `public, max-age=${MediaController.CACHE_SECONDS}, immutable`)
      // Inline, and with the library's own name, so "save image as" in the
      // kiosk browser offers something recognisable.
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`)

      // sendFile rather than a stream of our own: it handles Range requests,
      // conditional GETs and the error cases, which matters because these
      // are the largest responses the API produces.
      res.sendFile(absolutePath, error => (error ? reject(error) : resolve()))
    })
  }
}
