import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProperties } from '../../lib/core/AppProperties'
import { GoogleOAuth } from '../../lib/providers/calendar/GoogleOAuth'

/**
 * The handshake, and the failure everyone hits.
 *
 * A Google OAuth app left on the "Testing" consent screen expires its
 * refresh tokens after seven days. On a wall display that means the calendar
 * works for a week and then silently stops, so the message for that case is
 * worth a test of its own — it is the difference between a fixable problem
 * and a mystery.
 */
beforeEach(() => {
  AppProperties.reset()
  process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
  AppProperties.initialize('/definitely/not/here.properties')
  GoogleOAuth.reset()
})

const REDIRECT = 'http://localhost:8080/api/calendar/google/callback'

/** Answers the token endpoint with a payload, or a failure. */
function stubToken(response: { ok: boolean; status?: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    async () =>
      ({
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 400),
        text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body))
      }) as Response
  )
}

describe('GoogleOAuth configuration', () => {
  it('reports itself configured when both halves of the client are present', () => {
    expect(GoogleOAuth.isConfigured()).toBe(true)
    expect(GoogleOAuth.clientId()).toBe('client-id.apps.googleusercontent.com')
  })

  it('is not configured with only an id, which would fail at the token step', () => {
    AppProperties.reset()
    delete process.env.GOOGLE_CLIENT_SECRET
    AppProperties.initialize('/definitely/not/here.properties')

    expect(GoogleOAuth.isConfigured()).toBe(false)

    process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
  })
})

describe('GoogleOAuth.beginAuthorization', () => {
  it('asks for offline access and forces the consent screen', () => {
    const { url } = GoogleOAuth.beginAuthorization('source-1', REDIRECT)
    const params = new URL(url).searchParams

    // Without both of these Google issues a refresh token only on an
    // account's very first authorisation, so reconnecting later appears to
    // work and then fails on the first sync.
    expect(params.get('access_type')).toBe('offline')
    expect(params.get('prompt')).toBe('consent')
    expect(params.get('redirect_uri')).toBe(REDIRECT)
    expect(params.get('scope')).toContain('calendar.events')
  })

  it('refuses to start without a configured client', () => {
    AppProperties.reset()
    delete process.env.GOOGLE_CLIENT_ID
    AppProperties.initialize('/definitely/not/here.properties')

    expect(() => GoogleOAuth.beginAuthorization('source-1', REDIRECT)).toThrow(/No Google OAuth client/)

    process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com'
  })

  it('issues an unguessable state per authorisation', () => {
    const first = GoogleOAuth.beginAuthorization('source-1', REDIRECT).state
    const second = GoogleOAuth.beginAuthorization('source-1', REDIRECT).state

    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThan(20)
  })
})

describe('GoogleOAuth.claimAuthorization', () => {
  it('returns what the state was issued for', () => {
    const { state } = GoogleOAuth.beginAuthorization('source-7', REDIRECT)

    expect(GoogleOAuth.claimAuthorization(state)).toMatchObject({ sourceId: 'source-7', redirectUri: REDIRECT })
  })

  it('rejects a state nobody issued, so a forged callback does nothing', () => {
    expect(GoogleOAuth.claimAuthorization('made-up')).toBeNull()
  })

  it('accepts a state only once, so a replayed callback does nothing', () => {
    const { state } = GoogleOAuth.beginAuthorization('source-1', REDIRECT)

    expect(GoogleOAuth.claimAuthorization(state)).not.toBeNull()
    expect(GoogleOAuth.claimAuthorization(state)).toBeNull()
  })
})

describe('GoogleOAuth.exchangeCode', () => {
  it('returns the tokens Google issued', async () => {
    stubToken({ ok: true, body: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 } })

    const tokens = await GoogleOAuth.exchangeCode('code', REDIRECT)

    expect(tokens.refreshToken).toBe('refresh')
    expect(tokens.accessToken).toBe('access')
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('explains what to do when Google withholds the refresh token', async () => {
    // Happens when the account has authorised this client before; without a
    // refresh token nothing can sync tomorrow.
    stubToken({ ok: true, body: { access_token: 'access', expires_in: 3600 } })

    await expect(GoogleOAuth.exchangeCode('code', REDIRECT)).rejects.toThrow(/myaccount.google.com\/permissions/)
  })

  it('passes the reason through when Google refuses the exchange', async () => {
    stubToken({ ok: false, status: 400, body: { error: 'redirect_uri_mismatch' } })

    await expect(GoogleOAuth.exchangeCode('code', REDIRECT)).rejects.toThrow(/redirect_uri_mismatch/)
  })
})

describe('GoogleOAuth.accessTokenFor', () => {
  it('exchanges the refresh token, then reuses the result', async () => {
    const calls = vi.fn()
    vi.stubGlobal('fetch', async () => {
      calls()
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'access-1', expires_in: 3600 })
      } as Response
    })

    expect(await GoogleOAuth.accessTokenFor('refresh')).toBe('access-1')
    expect(await GoogleOAuth.accessTokenFor('refresh')).toBe('access-1')

    // A sync walks several pages; exchanging a token per request would be
    // both slow and rude.
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('names the seven-day testing-mode expiry when the grant is rejected', async () => {
    stubToken({ ok: false, status: 400, body: { error: 'invalid_grant' } })

    await expect(GoogleOAuth.accessTokenFor('refresh')).rejects.toThrow(/"Testing"/)
    await expect(GoogleOAuth.accessTokenFor('refresh')).rejects.toThrow(/seven days/)
  })

  it('refreshes again rather than serving a token about to expire', async () => {
    // 30 seconds is inside the minute of headroom the cache keeps, so this
    // one must not be reused — a token that expires mid-request would fail
    // a sync for no reason.
    stubToken({ ok: true, body: { access_token: 'access-1', expires_in: 30 } })
    expect(await GoogleOAuth.accessTokenFor('refresh')).toBe('access-1')

    stubToken({ ok: true, body: { access_token: 'access-2', expires_in: 3600 } })
    expect(await GoogleOAuth.accessTokenFor('refresh')).toBe('access-2')
  })

  it('does not keep a token it failed to refresh', async () => {
    stubToken({ ok: true, body: { access_token: 'access-1', expires_in: 30 } })
    expect(await GoogleOAuth.accessTokenFor('refresh')).toBe('access-1')

    stubToken({ ok: false, status: 400, body: { error: 'invalid_grant' } })
    await expect(GoogleOAuth.accessTokenFor('refresh')).rejects.toThrow()

    // The cached token is gone, so a later attempt asks Google again rather
    // than serving one that has been revoked.
    stubToken({ ok: true, body: { access_token: 'access-2', expires_in: 3600 } })
    expect(await GoogleOAuth.accessTokenFor('refresh')).toBe('access-2')
  })
})
