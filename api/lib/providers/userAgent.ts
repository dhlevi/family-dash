/**
 * The user-agent used for every outbound feed request.
 *
 * Deliberately *without* a URL in it. The `(+https://example.com/bot)`
 * convention is the polite standard for crawlers, but at least one major
 * publisher's edge (CBC) silently blackholes requests whose user-agent
 * contains a URL.
 */
export const OUTBOUND_USER_AGENT = 'family-dash/0.1 (self-hosted family dashboard)'
