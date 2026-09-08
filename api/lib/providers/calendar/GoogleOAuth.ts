import * as crypto from 'crypto'
import { AppProperties } from '../../core/AppProperties'
import { OUTBOUND_USER_AGENT } from '../userAgent'

/**
 * The OAuth side of the Google Calendar provider.
 *
 * Done with `fetch` against Google's documented endpoints rather than with
 * `googleapis`: that package is tens of megabytes and pulls in a large
 * dependency tree to cover the whole of Google Cloud, and what is needed
 * here is four HTTP calls. The same reasoning as the rest of the providers,
 * which all talk to their upstream directly.
 *
 * Only calendar scope is requested. The refresh token is stored on the
 * calendar source and never leaves the API — see `SECRET_CONFIG_KEYS` in
 * CalendarEndpoints.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/**
 * Read and write, because a family calendar you cannot add to from the wall
 * display is half a feature. `calendar.events` rather than the whole of
 * `calendar` so the app cannot delete or create calendars themselves.
 */
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']

const TIMEOUT_MS = 20000

/** How long a pending authorisation stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000

export interface GoogleTokens {
  accessToken: string
  /** Absent when Google chose not to issue a new one. */
  refreshToken: string | null
  expiresAt: Date
}

interface PendingAuthorization {
  sourceId: string
  redirectUri: string
  expiresAt: number
}

export class GoogleOAuth {
  /**
   * Access tokens by refresh token, so a sync does not exchange one every
   * time. In memory only: they last an hour and a restart can afford to ask
   * again.
   */
  private static accessTokens = new Map<string, { token: string; expiresAt: number }>()

  /** Authorisations waiting for their callback, by `state`. */
  private static pending = new Map<string, PendingAuthorization>()

  private constructor() {
    /* static only */
  }

  public static clientId(): string {
    return AppProperties.getString('google.clientId', '').trim()
  }

  private static clientSecret(): string {
    return AppProperties.getString('google.clientSecret', '').trim()
  }

  /** Whether an OAuth client has been configured at all. */
  public static isConfigured(): boolean {
    return GoogleOAuth.clientId().length > 0 && GoogleOAuth.clientSecret().length > 0
  }

  /**
   * Begins an authorisation, returning the URL to send the browser to.
   *
   * `state` ties the callback back to the source that started it and makes a
   * forged callback useless: a request arriving with a state nobody issued is
   * rejected rather than quietly attaching somebody else's tokens.
   *
   * `access_type=offline` with `prompt=consent` is what makes Google issue a
   * refresh token — without the prompt it only sends one the very first time
   * an account authorises the client, so re-connecting later would appear to
   * work and then fail on the first sync.
   */
  public static beginAuthorization(sourceId: string, redirectUri: string): { url: string; state: string } {
    if (!GoogleOAuth.isConfigured()) {
      throw new Error('No Google OAuth client is configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
    }

    GoogleOAuth.pruneStates()

    const state = crypto.randomBytes(24).toString('base64url')
    GoogleOAuth.pending.set(state, { sourceId, redirectUri, expiresAt: Date.now() + STATE_TTL_MS })

    const params = new URLSearchParams({
      client_id: GoogleOAuth.clientId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    })

    return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state }
  }

  /** Consumes a `state`, returning what it was issued for. */
  public static claimAuthorization(state: string): PendingAuthorization | null {
    GoogleOAuth.pruneStates()

    const pending = GoogleOAuth.pending.get(state)
    if (!pending) return null

    // Single use: a callback replayed later must not authorise anything.
    GoogleOAuth.pending.delete(state)

    return pending
  }

  /** Trades the code from the callback for tokens. */
  public static async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
    const payload = await GoogleOAuth.postToken({
      code,
      client_id: GoogleOAuth.clientId(),
      client_secret: GoogleOAuth.clientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })

    if (!payload.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Remove this app from your account at ' +
          'myaccount.google.com/permissions and connect again.'
      )
    }

    return GoogleOAuth.toTokens(payload)
  }

  /**
   * An access token for a refresh token, from the cache when it is still
   * good.
   *
   * A refresh that fails with `invalid_grant` is the one failure worth
   * naming precisely: it means the token has been revoked or expired, which
   * for an OAuth app left in "Testing" happens after seven days. Anyone
   * watching a wall display would otherwise just see events stop.
   */
  public static async accessTokenFor(refreshToken: string): Promise<string> {
    const cached = GoogleOAuth.accessTokens.get(refreshToken)
    // A minute of headroom, so a token cannot expire mid-request.
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

    let payload: TokenResponse
    try {
      payload = await GoogleOAuth.postToken({
        refresh_token: refreshToken,
        client_id: GoogleOAuth.clientId(),
        client_secret: GoogleOAuth.clientSecret(),
        grant_type: 'refresh_token'
      })
    } catch (error) {
      GoogleOAuth.accessTokens.delete(refreshToken)

      if ((error as Error).message.includes('invalid_grant')) {
        throw new Error(
          'Google has revoked this connection. If the OAuth consent screen is still in "Testing", ' +
            'refresh tokens expire after seven days — publish the app, then connect again in Settings.',
          { cause: error }
        )
      }
      throw error
    }

    const tokens = GoogleOAuth.toTokens(payload)
    GoogleOAuth.accessTokens.set(refreshToken, {
      token: tokens.accessToken,
      expiresAt: tokens.expiresAt.getTime()
    })

    return tokens.accessToken
  }

  /** Test-only: forget cached access tokens and pending authorisations. */
  public static reset(): void {
    GoogleOAuth.accessTokens.clear()
    GoogleOAuth.pending.clear()
  }

  private static async postToken(body: Record<string, string>): Promise<TokenResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': OUTBOUND_USER_AGENT
        },
        body: new URLSearchParams(body).toString(),
        signal: controller.signal
      })

      const text = await response.text()

      if (!response.ok) {
        // Google's error bodies are small and specific ("invalid_grant",
        // "redirect_uri_mismatch"); passing the text through is what makes a
        // misconfigured client diagnosable at all.
        throw new Error(`Google token request failed (${response.status}): ${text.slice(0, 300)}`)
      }

      return JSON.parse(text) as TokenResponse
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Google did not answer within ${TIMEOUT_MS / 1000}s`, { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private static toTokens(payload: TokenResponse): GoogleTokens {
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000)
    }
  }

  private static pruneStates(): void {
    const now = Date.now()
    for (const [state, pending] of GoogleOAuth.pending) {
      if (pending.expiresAt <= now) GoogleOAuth.pending.delete(state)
    }
  }
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}
