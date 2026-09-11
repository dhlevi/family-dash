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

export interface CityArtUrls {
  url: string
  thumbUrl: string
  svgUrl: string
}

/**
 * Generated artwork is addressed by id for the same reason photos are, and
 * offers both forms: the raster is what the screensaver loads, the SVG is the
 * master — resolution independent, and the one to print.
 */
export function cityArtUrls(id: string, updatedAt: Date): CityArtUrls {
  const version = updatedAt.getTime()

  return {
    url: `/media/city-art/${id}?v=${version}`,
    thumbUrl: `/media/city-art/${id}/thumb?v=${version}`,
    svgUrl: `/media/city-art/${id}/svg?v=${version}`
  }
}
