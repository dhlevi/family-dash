import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { AppProperties } from '../../lib/core/AppProperties'
import { ImageFile } from '../../lib/services/ImageFile'

/**
 * What the library will accept, and what it can work out about a picture.
 *
 * The capture date matters more than it looks: it is the order the slideshow
 * and the album tiles use, and the difference between a library sorted the
 * way the family remembers events and one sorted by when files happened to
 * be copied onto the volume.
 */
beforeAll(() => {
  AppProperties.reset()
  AppProperties.initialize('/definitely/not/here.properties')
})

/** A small real JPEG, optionally carrying an EXIF capture date. */
function jpeg(options: { takenAt?: string; width?: number; height?: number; orientation?: number } = {}) {
  const width = options.width ?? 120
  const height = options.height ?? 90

  let image = sharp({ create: { width, height, channels: 3, background: '#3b5b8c' } })

  if (options.takenAt) image = image.withExif({ IFD2: { DateTimeOriginal: options.takenAt } })
  // withExif does not set the orientation tag that metadata() reads back, so
  // the rotation flag has to be written the other way.
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation })

  return image.jpeg().toBuffer()
}

describe('ImageFile format support', () => {
  it('accepts the formats a camera or phone produces', () => {
    for (const name of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.gif', 'a.heic', 'a.HEIF', 'a.avif', 'a.tiff']) {
      expect(ImageFile.isSupported(name), name).toBe(true)
    }
  })

  it('refuses what is not a picture', () => {
    for (const name of ['a.mp4', 'a.pdf', 'a.txt', 'a.jpg.exe', 'noextension', 'a.svg']) {
      expect(ImageFile.isSupported(name), name).toBe(false)
    }
  })

  it('maps an extension to the type it is served as', () => {
    expect(ImageFile.mimeTypeFor('holiday.JPG')).toBe('image/jpeg')
    expect(ImageFile.mimeTypeFor('phone.heic')).toBe('image/heic')
    expect(ImageFile.mimeTypeFor('clip.mov')).toBeNull()
  })

  it('knows which formats a browser can actually display', () => {
    expect(ImageFile.isBrowserRenderable('image/jpeg')).toBe(true)
    expect(ImageFile.isBrowserRenderable('image/webp')).toBe(true)
    // The reason a HEIC needs a converted copy made for it.
    expect(ImageFile.isBrowserRenderable('image/heic')).toBe(false)
    expect(ImageFile.isBrowserRenderable('image/tiff')).toBe(false)
    expect(ImageFile.isBrowserRenderable(null)).toBe(false)
  })
})

describe('ImageFile.inspect', () => {
  it('reads the dimensions of a picture', async () => {
    const facts = await ImageFile.inspect(await jpeg({ width: 200, height: 150 }))

    expect(facts.width).toBe(200)
    expect(facts.height).toBe(150)
  })

  it('reads the capture date the camera recorded', async () => {
    const facts = await ImageFile.inspect(await jpeg({ takenAt: '2024:07:14 18:32:05' }))

    expect(facts.takenAt?.toISOString()).toBe('2024-07-14T18:32:05.000Z')
  })

  it('reports no date when there is no EXIF to read', async () => {
    const facts = await ImageFile.inspect(await jpeg())

    expect(facts.takenAt).toBeNull()
  })

  it('ignores the date on a camera whose clock was never set', async () => {
    // A dead battery leaves cameras reporting 1970 or 1980. Sorting every
    // such picture to the start of the library is worse than not knowing.
    const facts = await ImageFile.inspect(await jpeg({ takenAt: '1980:01:01 00:00:00' }))

    expect(facts.takenAt).toBeNull()
  })

  it('reports the dimensions a quarter-turned photo is displayed at', async () => {
    // Orientation 6 means the stored pixels are landscape but the picture is
    // portrait. Reporting the stored size would lay the grid out wrongly.
    const facts = await ImageFile.inspect(await jpeg({ width: 200, height: 150, orientation: 6 }))

    expect(facts.width).toBe(150)
    expect(facts.height).toBe(200)
  })

  it('returns nulls for a file that is not an image rather than throwing', async () => {
    // A hand-filled library will contain the odd truncated download, and one
    // of those must not stop a scan of several thousand photos.
    const facts = await ImageFile.inspect(Buffer.from('this is not a picture'))

    expect(facts).toEqual({ width: null, height: null, takenAt: null })
  })
})
