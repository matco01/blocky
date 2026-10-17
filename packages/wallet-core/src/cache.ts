/**
 * A short-lived cache for third-party reads that change slowly — prices, the
 * Arc protocol list — so a balance poll every 20s doesn't refetch them every
 * time, and parallel callers share one request instead of racing.
 *
 * Keyed per fetch function: production shares one cache through the global
 * `fetch`, while every test's fake fetch gets its own, so a value cached in one
 * test can never answer another. Failures are not cached.
 *
 * Some keys are per user (a wallet's holdings) or per question (a set of token
 * addresses), so expired entries are swept out as the server runs. Without
 * that, a long-lived process keeps one entry for every wallet and every token
 * set it has ever been asked about.
 */
type Entry = { expires: number; value: Promise<unknown> };

interface Cache {
  entries: Map<string, Entry>;
  sweptAt: number;
}

/** How often expired entries are cleared out, at most. Sweeping is a walk over every entry. */
const SWEEP_EVERY_MS = 60_000;

const caches = new WeakMap<typeof fetch, Cache>();

function cacheFor(fetchImpl: typeof fetch): Cache {
  let cache = caches.get(fetchImpl);
  if (!cache) {
    cache = { entries: new Map(), sweptAt: Date.now() };
    caches.set(fetchImpl, cache);
  }
  return cache;
}

/** Drop one entry, so the next read goes to the source. */
export function uncache(fetchImpl: typeof fetch, key: string): void {
  caches.get(fetchImpl)?.entries.delete(key);
}

export function cached<T>(fetchImpl: typeof fetch, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const cache = cacheFor(fetchImpl);
  const now = Date.now();

  const hit = cache.entries.get(key);
  if (hit && now < hit.expires) return hit.value as Promise<T>;

  const value = load();
  const entry: Entry = { expires: now + ttlMs, value };
  cache.entries.set(key, entry);
  // Not cached when it fails — but only this entry goes. A newer one that has
  // replaced it in the meantime is a different read, and stays.
  value.catch(() => {
    if (cache.entries.get(key) === entry) cache.entries.delete(key);
  });

  if (now - cache.sweptAt >= SWEEP_EVERY_MS) {
    cache.sweptAt = now;
    for (const [stale, candidate] of cache.entries) {
      if (candidate.expires <= now) cache.entries.delete(stale);
    }
  }

  return value;
}
