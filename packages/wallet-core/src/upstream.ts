/**
 * Reading from someone else's API: prices, quotes, fees, balances, history.
 *
 * Every one of those reads gets a deadline. Without one, a provider that stops
 * answering holds the user's request open — a card that never appears, a
 * balance that never loads — until the phone gives up first. Past the deadline
 * the read fails like any other failed read, and every caller already treats
 * that as "unavailable right now", never as zero.
 */

/** Long enough for a slow quote, short enough that the user isn't left waiting on a dead provider. */
export const UPSTREAM_TIMEOUT_MS = 10_000;

/** `fetch` options for a third-party read: whatever it needs, plus a deadline. */
export function upstream(init: RequestInit = {}, timeoutMs: number = UPSTREAM_TIMEOUT_MS): RequestInit {
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}
