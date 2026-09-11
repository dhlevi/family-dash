import { AppProperties } from '../../core/AppProperties'
import { OUTBOUND_USER_AGENT } from '../userAgent'
import type { TileId } from './mercator'

/**
 * Elevation tiles, for the hillshade under sparse artwork.
 *
 * Mapterhorn by default: open data, no key, no account, and global 30m
 * coverage or better.
 *
 * Tiles are terrarium-encoded in WebP. That pairing is worth noting: terrarium
 * packs an elevation into the three colour channels, so the encoding has to be
 * lossless or the heights come back wrong. Checked against Yr Wyddfa, which
 * decodes to 1083m against a true 1085.
 */

export interface FetchedTerrainTile {
  id: TileId
  /** Raw WebP bytes; decoding needs an image library, which lives elsewhere. */
  data: Uint8Array
}

export class TerrainSource {
  /** Terrain tiles are 512px, unlike the 256 the vector pyramid implies. */
  public static readonly TILE_PIXELS = 512

  private static readonly CONCURRENCY = 4

  public static urlTemplate(): string {
    return AppProperties.getString('cityart.terrain.url', 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp')
  }

  public static attribution(): string {
    return AppProperties.getString('cityart.terrain.attribution', 'Terrain by Mapterhorn')
  }

  private static timeoutMs(): number {
    return AppProperties.getNumber('cityart.terrain.timeoutMs', 20000)
  }

  public static enabled(): boolean {
    return TerrainSource.urlTemplate().length > 0
  }

  /** Never look below this; coarser than it, there is no relief left to see. */
  private static readonly MIN_ZOOM = 9

  /**
   * The deepest zoom that actually has tiles here.
   *
   * Coverage is not uniform and the difference is large: where a national
   * survey exists (Wales, Canada, Japan) tiles go to z15 and beyond, but
   * across most of the world there is only the global 30m layer, which stops
   * at z12. Valparaíso is the case that found this: twenty tiles requested,
   * twenty 404s, and a hillshade that silently never appeared for most of
   * South America, Africa and Asia.
   *
   * Dropping a zoom costs nothing worth having. A hillshade is computed from
   * the slope between neighbouring samples, and that slope is the same whether
   * the ground is sampled every 8 metres or every 34. Asking for z14 over 30m data would
   * only have returned the same information, interpolated.
   */
  public static async deepestZoom(preferred: number, centre: TileId): Promise<number | null> {
    const template = TerrainSource.urlTemplate()
    if (template.length === 0) return null

    for (let zoom = preferred; zoom >= TerrainSource.MIN_ZOOM; zoom--) {
      const shift = preferred - zoom
      const url = template
        .replace('{z}', String(zoom))
        .replace('{x}', String(Math.floor(centre.x / 2 ** shift)))
        .replace('{y}', String(Math.floor(centre.y / 2 ** shift)))

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TerrainSource.timeoutMs())

      try {
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: { 'User-Agent': OUTBOUND_USER_AGENT }
        })

        if (response.ok) return zoom
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }

    return null
  }

  /**
   * Fetches the terrain for a view.
   *
   * A missing tile is an ordinary answer, not a failure: the pyramid thins out
   * at high zoom in places nobody has surveyed, and a hillshade is decoration.
   * Anything absent simply leaves that part of the picture flat.
   */
  public static async fetchTiles(ids: readonly TileId[]): Promise<FetchedTerrainTile[]> {
    const template = TerrainSource.urlTemplate()
    if (template.length === 0) return []

    const results: FetchedTerrainTile[] = []
    let next = 0

    const workers = Array.from({ length: Math.min(TerrainSource.CONCURRENCY, ids.length) }, async () => {
      for (;;) {
        const id = ids[next++]
        if (!id) return

        const url = template.replace('{z}', String(id.zoom)).replace('{x}', String(id.x)).replace('{y}', String(id.y))

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TerrainSource.timeoutMs())

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': OUTBOUND_USER_AGENT, Accept: 'image/webp,image/png,*/*' }
          })

          if (!response.ok) continue

          const body = new Uint8Array(await response.arrayBuffer())
          if (body.byteLength > 0) results.push({ id, data: body })
        } catch {
          // A hillshade is worth having and not worth failing over.
          continue
        } finally {
          clearTimeout(timer)
        }
      }
    })

    await Promise.all(workers)
    return results
  }
}
