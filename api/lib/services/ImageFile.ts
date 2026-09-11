import { execFile } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import exifReader from 'exif-reader'
import sharp from 'sharp'
import { AppProperties } from '../core/AppProperties'

const run = promisify(execFile)

/**
 * Reading and resizing image files.
 *
 * Wraps sharp so the rest of the code never touches it directly: everything
 * that follows from the choice of image library, which formats are
 * accepted, how orientation is applied, what a thumbnail is, is decided
 * here.
 */

/** Extensions the library will index, and the mime type each is served as. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  // Straight off an iPhone. See HEVC_CODED below: these need a decoder
  // sharp does not bundle, and no browser can display them either, so the
  // Pictures page shows a generated copy rather than the file itself.
  '.heic': 'image/heic',
  '.heif': 'image/heif'
}

/**
 * Formats whose pixels sharp cannot get at.
 *
 * sharp's prebuilt libheif reads HEIF containers but carries no HEVC
 * decoder, so an iPhone photo yields its dimensions and EXIF and then fails
 * on any attempt to actually decode it ("bad seek", from libheif running off
 * the end of the data it could not parse). `heif-convert` from
 * libheif-tools, installed in the image, does have the decoder, so these
 * take one extra step through it on the way in.
 */
const HEVC_CODED = new Set(['.heic', '.heif'])

/** Formats a browser can render, so the original can be shown full size. */
const BROWSER_RENDERABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export interface ImageFacts {
  /** Dimensions as displayed, with any EXIF rotation already applied. */
  width: number | null
  height: number | null
  /** From EXIF where the camera recorded it. */
  takenAt: Date | null
}

export class ImageFile {
  private constructor() {
    /* static only */
  }

  public static extensions(): string[] {
    return Object.keys(MIME_BY_EXTENSION)
  }

  public static isSupported(filename: string): boolean {
    return path.extname(filename).toLowerCase() in MIME_BY_EXTENSION
  }

  public static mimeTypeFor(filename: string): string | null {
    return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? null
  }

  public static isBrowserRenderable(mimeType: string | null): boolean {
    return mimeType !== null && BROWSER_RENDERABLE.has(mimeType)
  }

  /** The thumbnail's longest edge, from `media.thumbnail.width`. */
  public static thumbnailWidth(): number {
    return AppProperties.getNumber('media.thumbnail.width', 480)
  }

  /**
   * Reads the dimensions and capture date of an image.
   *
   * Never throws: a file that is not really an image, or is truncated, comes
   * back with nulls. A library filled by hand will contain the odd broken
   * file and one of those should not stop a scan.
   */
  public static async inspect(source: string | Buffer): Promise<ImageFacts> {
    try {
      const metadata = await sharp(source, { failOn: 'none' }).metadata()

      // Orientations 5-8 are the quarter turns, where the stored pixels are
      // transposed relative to how the picture should be shown.
      const rotated = (metadata.orientation ?? 1) >= 5
      const width = metadata.width ?? null
      const height = metadata.height ?? null

      return {
        width: rotated ? height : width,
        height: rotated ? width : height,
        takenAt: ImageFile.takenAtFrom(metadata.exif)
      }
    } catch {
      return { width: null, height: null, takenAt: null }
    }
  }

  /**
   * Writes a thumbnail, returning whether one was produced.
   *
   * `rotate()` before resizing bakes in the EXIF orientation, so the small
   * version is the right way up without the browser having to be told. The
   * output is WebP, which every browser the kiosk could be running supports
   * and which is the reason a HEIC from a phone is viewable at all.
   */
  public static async writeThumbnail(sourcePath: string, destinationPath: string): Promise<boolean> {
    return ImageFile.resizeInto(sourcePath, destinationPath, ImageFile.thumbnailWidth(), 78)
  }

  /**
   * Writes a copy a browser can display, for a format it cannot.
   *
   * Only HEIC reaches this. Sized for the screen rather than for a tile,
   * because this is what the slideshow and the full-screen view show.
   */
  public static async writeDisplayCopy(sourcePath: string, destinationPath: string): Promise<boolean> {
    return ImageFile.resizeInto(sourcePath, destinationPath, ImageFile.displayWidth(), 86)
  }

  /**
   * Renders a small version of a generated map artwork, as a buffer.
   *
   * Rasterised from the SVG rather than resampled from the WebP, so the tile
   * is drawn at its own size instead of being a shrunk copy of a compressed
   * one.
   */
  public static async renderCityArtThumbnail(svgPath: string): Promise<Buffer | null> {
    try {
      return await sharp(svgPath, { density: 96 })
        .resize(ImageFile.thumbnailWidth(), null, { withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
    } catch (error) {
      console.warn(`Could not render a thumbnail for '${svgPath}': ${(error as Error).message}`)
      return null
    }
  }

  /** The longest edge of a display copy, from `media.display.width`. */
  public static displayWidth(): number {
    return AppProperties.getNumber('media.display.width', 2048)
  }

  private static async resizeInto(
    sourcePath: string,
    destinationPath: string,
    longestEdge: number,
    quality: number
  ): Promise<boolean> {
    let decoded: string | null = null

    try {
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })

      decoded = await ImageFile.decodeIfNeeded(sourcePath)

      await sharp(decoded ?? sourcePath, { failOn: 'none' })
        .rotate()
        .resize(longestEdge, longestEdge, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(destinationPath)

      return true
    } catch (error) {
      console.warn(`Could not resize ${sourcePath}: ${(error as Error).message}`)
      return false
    } finally {
      if (decoded) await fs.promises.rm(decoded, { force: true }).catch(() => undefined)
    }
  }

  /**
   * Decodes a format sharp cannot, returning a temporary file to read
   * instead, or null when the original can be used directly.
   */
  private static async decodeIfNeeded(sourcePath: string): Promise<string | null> {
    if (!HEVC_CODED.has(path.extname(sourcePath).toLowerCase())) return null

    const temporary = path.join(os.tmpdir(), `family-dash-heic-${crypto.randomBytes(8).toString('hex')}.png`)

    // PNG rather than JPEG so the one intermediate step is lossless; the
    // only lossy step stays the WebP that gets written at the end.
    await run('heif-convert', ['--quality', '100', sourcePath, temporary], { timeout: 60_000 })

    return temporary
  }

  /**
   * The capture date from an EXIF block.
   *
   * EXIF timestamps carry no timezone, and exif-reader reads them as if they
   * were UTC. For sorting a family library that is close enough  and it beats
   * the file's own date, which is when the file was copied rather than when the
   * photo was taken.
   */
  private static takenAtFrom(exif: Buffer | undefined): Date | null {
    if (!exif) return null

    try {
      const parsed = exifReader(exif)
      const candidate = parsed?.Photo?.DateTimeOriginal ?? parsed?.Image?.DateTime

      if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime())) return null

      // Cameras with a dead clock report 1970 or 1980; treat those as unknown
      // rather than sorting every such photo to the beginning of time.
      return candidate.getFullYear() > 1990 ? candidate : null
    } catch {
      return null
    }
  }
}
