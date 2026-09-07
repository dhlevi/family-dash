import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from './client'

/**
 * The client is the single place errors from the API are turned into
 * something the UI can act on, so its error mapping is worth pinning down —
 * particularly the distinction between "the API said no" and "the API is not
 * there", which is what decides whether the header shows Offline.
 */
describe('api client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  }

  it('prefixes requests with /api', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await api.get('/tasks')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks')
  })

  it('serialises query parameters and drops empty ones', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))

    await api.get('/tasks', { query: { assignee: 'Sam', done: false, category: undefined, tag: '' } })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain('assignee=Sam')
    expect(url).toContain('done=false')
    expect(url).not.toContain('category')
    expect(url).not.toContain('tag')
  })

  it('sends JSON bodies with a content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: '1' }, 201))

    await api.post('/tasks', { title: 'Bins out' })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBe('{"title":"Bins out"}')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('lets FormData set its own content type so the multipart boundary survives', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: '1' }, 201))
    const form = new FormData()
    form.set('file', new Blob(['x']), 'photo.jpg')

    await api.post('/photos', form)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toBeUndefined()
    expect(init.body).toBe(form)
  })

  it('returns undefined for a 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(api.delete('/tasks/1')).resolves.toBeUndefined()
  })

  it('turns an API error body into an ApiRequestError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'No such task', code: 'NOT_FOUND' }, 404))

    const error = await api.get('/tasks/nope').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'No such task' })
    expect((error as ApiRequestError).isNetworkError).toBe(false)
  })

  it('copes with a non-JSON error body, as nginx returns while the API restarts', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }))

    const error = (await api.get('/tasks').catch((caught: unknown) => caught)) as ApiRequestError

    expect(error.status).toBe(502)
    expect(error.message).toBe('Bad Gateway')
  })

  it('flags an unreachable API as a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = (await api.get('/tasks').catch((caught: unknown) => caught)) as ApiRequestError

    expect(error.isNetworkError).toBe(true)
    expect(error.code).toBe('NETWORK')
  })

  it('treats a 503 health report as readable rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'unhealthy', checks: [] }, 503))

    await expect(api.health()).resolves.toMatchObject({ status: 'unhealthy' })
  })
})
