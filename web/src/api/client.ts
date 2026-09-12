/**
 * The HTTP client every API module goes through.
 *
 * Requests are same-origin `/api/...` in both dev (Vite proxies) and
 * production (nginx proxies), so there is no base-URL configuration to get
 * wrong on the Pi.
 */

export class ApiRequestError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details?: unknown

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** True when the request never reached the API (Pi offline, API restarting). */
  public get isNetworkError(): boolean {
    return this.status === 0
  }
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /** Milliseconds before the request is abandoned. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000

/**
 * Statuses nginx returns on the API's behalf when it cannot reach it. These
 * mean "not there", not "said no", however much they look like the latter.
 */
const GATEWAY_STATUSES = new Set([502, 503, 504])

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `/api${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }

  const serialized = params.toString()
  return serialized ? `${url}?${serialized}` : url
}

async function toError(response: Response): Promise<ApiRequestError> {
  try {
    const payload = await response.json()
    return new ApiRequestError(
      response.status,
      typeof payload?.message === 'string' ? payload.message : response.statusText,
      typeof payload?.code === 'string' ? payload.code : 'ERROR',
      payload?.details
    )
  } catch {
    // A non-JSON error body means something upstream of the API answered
    // usually nginx while the API container is restarting.
    return new ApiRequestError(response.status, response.statusText || 'Request failed')
  }
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const { query, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  // Without a timeout, a widget polling a wedged API would hang forever and
  // the dashboard would show a spinner with no explanation.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs)
  if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })

  const isFormData = body instanceof FormData

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      // FormData sets its own content-type with the multipart boundary.
      headers: body !== undefined && !isFormData ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: controller.signal
    })

    if (!response.ok) throw await toError(response)

    if (response.status === 204) return undefined as T

    const contentType = response.headers.get('content-type') ?? ''
    return contentType.includes('application/json') ? ((await response.json()) as T) : ((await response.text()) as T)
  } catch (error) {
    if (error instanceof ApiRequestError) throw error

    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiRequestError(0, `The API did not respond within ${timeoutMs / 1000}s`, 'TIMEOUT')
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError(0, 'Request cancelled', 'ABORTED')
    }

    throw new ApiRequestError(0, 'Cannot reach the API', 'NETWORK', error)
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),

  /** /healthCheck sits outside /api, so it needs its own call. */
  health: async <T>(): Promise<T> => {
    let response: Response
    try {
      response = await fetch('/healthCheck')
    } catch (error) {
      throw new ApiRequestError(0, 'Cannot reach the API', 'NETWORK', error)
    }

    // Two very different things arrive here as a 5xx. The API answers its own
    // health check with 503 when a check is failing, and that report is the
    // most useful thing we get all day. nginx answers with 502/503/504 when
    // the API is not listening at all - during a rebuild, or while the
    // container waits on Postgres - and its body is an HTML error page.
    //
    // The status code cannot tell them apart, so the body does: a report has
    // a status field, an nginx page does not parse as JSON at all. Getting
    // this wrong is not cosmetic. An unreachable API misread as a reachable
    // one leaves the display insisting it is Connected while every widget
    // fails, and nothing ever retries.
    const payload = await response.json().catch(() => null)
    if (payload !== null && typeof payload === 'object' && 'status' in payload) return payload as T

    if (GATEWAY_STATUSES.has(response.status)) {
      throw new ApiRequestError(0, 'The dashboard service is not answering', 'NETWORK')
    }

    throw new ApiRequestError(response.status, response.statusText || 'Health check failed')
  }
}
