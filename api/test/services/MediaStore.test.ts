import * as os from 'os'
import * as path from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { AppProperties } from '../../lib/core/AppProperties'
import { MediaStore } from '../../lib/services/MediaStore'

/**
 * The media volume is the one place the API touches arbitrary files, and it
 * is a folder a person fills by hand — possibly over a network share, with
 * whatever names their camera and their phone produce. These cover the two
 * things that has to get right: staying inside the library, and turning an
 * arbitrary name into something writable.
 */
beforeAll(() => {
  AppProperties.reset()
  AppProperties.initialize('/definitely/not/here.properties')
})

const BASE = path.join(os.tmpdir(), 'library')

describe('MediaStore.resolveWithin', () => {
  it('resolves an ordinary relative path', () => {
    expect(MediaStore.resolveWithin(BASE, 'Holiday/beach.jpg')).toBe(path.join(BASE, 'Holiday', 'beach.jpg'))
  })

  it('refuses anything that climbs out of the library', () => {
    for (const escape of [
      '../secrets.txt',
      '../../etc/passwd',
      'Holiday/../../etc/passwd',
      'Holiday/../..',
      './../outside.jpg'
    ]) {
      expect(MediaStore.resolveWithin(BASE, escape), escape).toBeNull()
    }
  })

  it('refuses an absolute path, which would ignore the base entirely', () => {
    expect(MediaStore.resolveWithin(BASE, '/etc/passwd')).toBeNull()
    expect(MediaStore.resolveWithin(BASE, path.join(BASE, 'inside.jpg'))).toBeNull()
  })

  it('refuses an empty path rather than handing back the directory', () => {
    expect(MediaStore.resolveWithin(BASE, '')).toBeNull()
  })

  it('allows a path that merely contains dots', () => {
    expect(MediaStore.resolveWithin(BASE, 'my..album/a..b.jpg')).toBe(path.join(BASE, 'my..album', 'a..b.jpg'))
  })

  it('is not fooled by a sibling directory that starts with the base name', () => {
    // `/tmp/library-other` shares a prefix with `/tmp/library` but is not
    // inside it, which a naive startsWith check would wave through.
    expect(MediaStore.resolveWithin(BASE, '../library-other/x.jpg')).toBeNull()
  })
})

describe('MediaStore.safeFilename', () => {
  it('keeps an ordinary name as it is', () => {
    expect(MediaStore.safeFilename('beach-day.jpg', '.jpg')).toBe('beach-day.jpg')
  })

  it('strips directory separators, so an upload cannot name a path', () => {
    expect(MediaStore.safeFilename('../../etc/passwd.jpg', '.jpg')).toBe('passwd.jpg')
    expect(MediaStore.safeFilename('C:\\Users\\me\\pic.jpg', '.jpg')).toBe('C-Users-me-pic.jpg')
  })

  it('replaces spaces and punctuation a network share would object to', () => {
    expect(MediaStore.safeFilename('Anna & Sam @ the beach!.jpg', '.jpg')).toBe('Anna-Sam-the-beach.jpg')
  })

  it('falls back to a usable name when nothing survives', () => {
    expect(MediaStore.safeFilename('???.jpg', '.jpg')).toBe('photo.jpg')
  })

  it('never produces a dotfile, which the scanner would skip and then unindex', () => {
    for (const awkward of ['.jpg', '...jpg', '.hidden.jpg', '-.jpg']) {
      const result = MediaStore.safeFilename(awkward, '.jpg')
      expect(result.startsWith('.'), `${awkward} -> ${result}`).toBe(false)
      expect(result.endsWith('.jpg'), `${awkward} -> ${result}`).toBe(true)
    }
  })

  it('keeps names short enough for any filesystem', () => {
    const long = `${'a'.repeat(400)}.jpg`
    expect(MediaStore.safeFilename(long, '.jpg').length).toBeLessThanOrEqual(64)
  })
})

describe('MediaStore derivative names', () => {
  it('gives a photo the same thumbnail name every time', () => {
    const first = MediaStore.thumbRelPathFor('Holiday/beach.jpg')
    expect(MediaStore.thumbRelPathFor('Holiday/beach.jpg')).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{40}\.webp$/)
  })

  it('gives different photos different names, whatever they are called', () => {
    // Names that a separator-substitution scheme would collide on.
    expect(MediaStore.thumbRelPathFor('a/b.jpg')).not.toBe(MediaStore.thumbRelPathFor('a-b.jpg'))
    expect(MediaStore.thumbRelPathFor('a__b.jpg')).not.toBe(MediaStore.thumbRelPathFor('a/b.jpg'))
  })

  it('keeps the display copy distinct from the thumbnail', () => {
    expect(MediaStore.displayRelPathFor('Holiday/beach.jpg')).not.toBe(MediaStore.thumbRelPathFor('Holiday/beach.jpg'))
  })
})
