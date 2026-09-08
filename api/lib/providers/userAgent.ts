/**
 * The user-agent used for every outbound feed request.
 *
 * Deliberately *without* a URL in it. The `(+https://example.com/bot)`
 * convention is the polite standard for crawlers, but at least one major
 * publisher's edge (CBC) silently blackholes requests whose user-agent
 * contains a URL — the connection simply hangs until it times out, with no
 * status and no error. Measured while building this: with the URL, a 20s
 * timeout; without it, 115ms.
 *
 * That failure mode is particularly nasty because it looks like a network
 * problem rather than a rejected request, so it is worth keeping this in one
 * place with the reason attached.
 */
export const OUTBOUND_USER_AGENT = 'family-dash/0.1 (self-hosted family dashboard)'
