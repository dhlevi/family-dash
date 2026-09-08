import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Uploading is the one part of the library a person drives directly, and a
 * phone's share sheet will happily send twenty pictures at once. These pin
 * down the behaviour that matters there: one bad file does not lose the
 * other nineteen, and an album name cannot become a folder name that a
 * network share, or the scanner, will not accept.
 */
const create = vi.fn()
const importPhoto = vi.fn(async ({ filename, album }: { filename: string; album: string }) => ({
  id: `photo-${filename}`,
  album,
  filename
}))

vi.mock('../../lib/repositories/PhotoRepository', () => ({
  PhotoRepository: class {
    public create = create
    public list = vi.fn(async () => [])
    public albums = vi.fn(async () => [])
    public byId = vi.fn(async () => null)
    public update = vi.fn(async () => null)
    public count = vi.fn(async () => 0)
  }
}))

vi.mock('../../lib/services/PhotoService', () => ({
  PhotoService: class {
    public import = importPhoto
    public remove = vi.fn(async () => false)
    public scan = vi.fn(async () => ({}))
  }
}))

const { PhotoEndpoints } = await import('../../lib/services/PhotoEndpoints')

const endpoints = new PhotoEndpoints()

const file = (originalname: string) => ({
  originalname,
  buffer: Buffer.from('pretend image bytes'),
  mimetype: 'image/jpeg',
  size: 19
})

beforeEach(() => {
  importPhoto.mockClear()
})

describe('PhotoEndpoints.upload', () => {
  it('adds every picture in one multipart request', async () => {
    const outcome = await endpoints.upload([file('a.jpg'), file('b.png'), file('c.heic')], 'Holiday')

    expect(outcome.added).toHaveLength(3)
    expect(outcome.rejected).toEqual([])
    expect(importPhoto.mock.calls.map(([request]) => request.album)).toEqual(['Holiday', 'Holiday', 'Holiday'])
  })

  it('keeps the good pictures when one file is not an image', async () => {
    const outcome = await endpoints.upload([file('a.jpg'), file('notes.txt'), file('b.jpg')], 'Holiday')

    expect(outcome.added.map(photo => photo.filename)).toEqual(['a.jpg', 'b.jpg'])
    expect(outcome.rejected).toHaveLength(1)
    expect(outcome.rejected[0]!.filename).toBe('notes.txt')
  })

  it('reports the one that failed on the way to disk, and keeps the rest', async () => {
    importPhoto.mockImplementationOnce(() => Promise.reject(new Error('No space left on device')))

    const outcome = await endpoints.upload([file('a.jpg'), file('b.jpg')], '')

    expect(outcome.added).toHaveLength(1)
    expect(outcome.rejected[0]).toMatchObject({ filename: 'a.jpg', reason: 'No space left on device' })
  })

  it('fails the request only when nothing at all could be added', async () => {
    await expect(endpoints.upload([file('notes.txt')], '')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('refuses a request with no files', async () => {
    await expect(endpoints.upload([], '')).rejects.toMatchObject({ statusCode: 400 })
    await expect(endpoints.upload(undefined, '')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('treats a missing album as the top of the library', async () => {
    await endpoints.upload([file('a.jpg')], undefined)

    expect(importPhoto.mock.calls[0]![0].album).toBe('')
  })

  it('refuses an album name that would not survive becoming a folder', async () => {
    for (const bad of ['../escape', 'a/b', 'C:\\pics', 'why?', 'a|b', '.', '..']) {
      await expect(endpoints.upload([file('a.jpg')], bad), bad).rejects.toThrow()
    }

    expect(importPhoto).not.toHaveBeenCalled()
  })

  it('accepts an album name with spaces and accents', async () => {
    await endpoints.upload([file('a.jpg')], '  Été à la mer  ')

    // Trimmed, because a folder with a trailing space is its own kind of pain.
    expect(importPhoto.mock.calls[0]![0].album).toBe('Été à la mer')
  })
})

describe('PhotoEndpoints.update', () => {
  it('explains that albums are folders rather than silently doing nothing', async () => {
    await expect(endpoints.update('photo-1', { album: 'Elsewhere' })).rejects.toThrow(/folder on the media volume/)
  })
})

describe('PhotoEndpoints.remove', () => {
  it('reports an unknown photo as a 404', async () => {
    await expect(endpoints.remove('nope')).rejects.toMatchObject({ statusCode: 404 })
  })
})
