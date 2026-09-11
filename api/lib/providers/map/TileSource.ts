import { AppProperties } from '../../core/AppProperties'
import { OUTBOUND_USER_AGENT } from '../userAgent'
import type { FetchedTile } from './MapArtRenderer'
import type { TileId } from './mercator'

/**
 * Where the vector tiles come from.
 *
 * OpenFreeMap by default: no key, no account, no quota, and the whole thing is
 * open source, so the one dependency this feature has on the outside world is
 * one that cannot expire in the way an API key can. Point `cityart.tiles.url`
 * at your own tile server and nothing else changes.
 *
 * The indirection through a TileJSON document is not optional. The planet
 * tiles live under a dated path — `planet/20260906_080001_pt/{z}/{x}/{y}.pbf` —
 * that rolls forward when the data is rebuilt, so a hardcoded tile URL works
 * until it silently stops working some week later. The document is asked for
 * the current path and the answer is held for a few hours.
 */

interface TileJson {
  tiles?: string[]
  minzoom?: number
  maxzoom?: number
  attribution?: string
}

interface Resolved {
  template: string
  attribution: string
  fetchedAt: number
}

export class TileSource {
  /** How long a resolved tile path is trusted. The planet rebuilds weekly. */
  private static readonly TILEJSON_TTL_MS = 6 * 60 * 60 * 1000

  /** Tiles are small and the server is fast; more than this is just rude. */
  private static readonly CONCURRENCY = 6

  private static resolved: Resolved | null = null

  private static tileJsonUrl(): string {
    return AppProperties.getString('cityart.tiles.url', 'https://tiles.openfreemap.org/planet')
  }

  private static timeoutMs(): number {
    return AppProperties.getNumber('cityart.tiles.timeoutMs', 20000)
  }

  /** Forget the cached tile path, so the next render resolves it again. */
  public static reset(): void {
    TileSource.resolved = null
  }

  private static async resolve(): Promise<Resolved> {
    const cached = TileSource.resolved
    if (cached && Date.now() - cached.fetchedAt < TileSource.TILEJSON_TTL_MS) return cached

    const url = TileSource.tileJsonUrl()
    const response = await TileSource.request(url)

    if (!response.ok) {
      throw new Error(`Tile server ${url} answered ${response.status} ${response.statusText}`)
    }

    const document = (await response.json()) as TileJson
    const template = document.tiles?.[0]

    if (!template || !template.includes('{z}')) {
      throw new Error(`Tile server ${url} did not offer a usable tile URL template`)
    }

    const next: Resolved = {
      template,
      attribution: document.attribution ?? '',
      fetchedAt: Date.now()
    }

    TileSource.resolved = next
    return next
  }

  /**
   * A request with a user-agent and a deadline.
   *
   * Both matter: OpenFreeMap refuses some default client user-agents outright
   * — Node's `fetch` is fine, but a bare scripting one is a 403 — and a tile
   * server that accepts a connection and then stalls would otherwise hang a
   * background task until the process restarts.
   */
  private static async request(url: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TileSource.timeoutMs())

    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': OUTBOUND_USER_AGENT, Accept: 'application/x-protobuf,*/*' }
      })
    } finally {
      clearTimeout(timer)
    }
  }

  public static async attribution(): Promise<string> {
    return (await TileSource.resolve()).attribution
  }

  /**
   * Fetches every tile in `ids`, in parallel but not all at once.
   *
   * A 404 is an ordinary answer rather than a failure: the tile pyramid has
   * nothing over open ocean, and a coastal city's view legitimately includes
   * squares that do not exist. Those come back absent and the renderer simply
   * has less to draw there.
   */
  public static async fetchTiles(ids: TileId[]): Promise<FetchedTile[]> {
    const { template } = await TileSource.resolve()
    const results: FetchedTile[] = []
    let next = 0

    const workers = Array.from({ length: Math.min(TileSource.CONCURRENCY, ids.length) }, async () => {
      for (;;) {
        const index = next++
        const id = ids[index]
        if (!id) return

        const url = template.replace('{z}', String(id.zoom)).replace('{x}', String(id.x)).replace('{y}', String(id.y))

        const response = await TileSource.request(url)

        if (response.status === 404 || response.status === 204) continue
        if (!response.ok) throw new Error(`Tile ${id.zoom}/${id.x}/${id.y} answered ${response.status}`)

        const body = new Uint8Array(await response.arrayBuffer())
        if (body.byteLength > 0) results.push({ id, data: body })
      }
    })

    await Promise.all(workers)
    return results
  }
}
