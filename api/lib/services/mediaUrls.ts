/**
 * The URLs the browser fetches images from.
 *
 * One definition, used by every repository that returns something with a
 * picture attached. Photos are addressed by id rather than by path — see
 * MediaController — and carry their row's `updated_at` as a version, because
 * these responses are cached for a year: a picture replaced on the media
 * volume keeps its id, so without the version it would stay hidden behind
 * that cache.
 */
export interface PhotoUrls {
  url: string
  thumbUrl: string
}

export function photoUrls(id: string, updatedAt: Date): PhotoUrls {
  const version = updatedAt.getTime()

  return {
    url: `/media/photos/${id}?v=${version}`,
    thumbUrl: `/media/thumbs/${id}?v=${version}`
  }
}
