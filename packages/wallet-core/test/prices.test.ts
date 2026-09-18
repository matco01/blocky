import { describe, expect, it } from 'vitest';
import { getTokenPriceUsd, KNOWN_SYMBOLS } from '../src';

function fakeFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

  return { impl, calls };
}

describe('token prices', () => {
  it('looks up a known symbol by its DefiLlama coingecko slug', async () => {
    const { impl, calls } = fakeFetch(200, {
      coins: { 'coingecko:ethereum': { price: 2628.32, symbol: 'ETH', timestamp: 1789767100, confidence: 0.99 } },
    });

    const quote = await getTokenPriceUsd('eth', impl);

    expect(quote).toEqual({ symbol: 'ETH', usd: 2628.32, confidence: 0.99, asOf: new Date(1789767100_000).toISOString() });
    expect(calls[0]).toContain('coingecko:ethereum');
  });

  it('is case-insensitive on the symbol', async () => {
    const { impl } = fakeFetch(200, {
      coins: { 'coingecko:bitcoin': { price: 81135, symbol: 'BTC', timestamp: 1, confidence: 0.99 } },
    });

    expect((await getTokenPriceUsd('BtC', impl))?.symbol).toBe('BTC');
  });

  it('returns null for a symbol we do not curate, without making a request', async () => {
    const { impl, calls } = fakeFetch(200, { coins: {} });

    expect(await getTokenPriceUsd('NOTATOKEN', impl)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null when the API has nothing for a symbol we do curate', async () => {
    const { impl } = fakeFetch(200, { coins: {} });

    expect(await getTokenPriceUsd('ETH', impl)).toBeNull();
  });

  it('throws on an actual API failure, distinct from "no price"', async () => {
    const { impl } = fakeFetch(503, {});

    await expect(getTokenPriceUsd('ETH', impl)).rejects.toThrow(/503/);
  });

  it('curates POL and MATIC to the same slug, since Polygon renamed its token', () => {
    expect(KNOWN_SYMBOLS.POL).toBe(KNOWN_SYMBOLS.MATIC);
  });
});
