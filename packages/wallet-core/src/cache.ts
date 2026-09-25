/**
 * A short-lived cache for third-party reads that change slowly — prices, the
 * Arc protocol list — so a balance poll every 20s doesn't refetch them every
 * time, and parallel callers share one request instead of racing.
 *
 * Keyed per fetch function: production shares one cache through the global
 * `fetch`, while every test's fake fetch gets its own, so a value cached in one
 * test can never answer another. Failures are not cached.
 */
type Entry = { at: number; value: Promise<unknown> };

const caches = new WeakMap<typeof fetch, Map<string, Entry>>();

/** Drop one entry, so the next read goes to the source. */
export function uncache(fetchImpl: typeof fetch, key: string): void {
  caches.get(fetchImpl)?.delete(key);
}

export function cached<T>(fetchImpl: typeof fetch, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  let cache = caches.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    caches.set(fetchImpl, cache);
  }

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;

  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
