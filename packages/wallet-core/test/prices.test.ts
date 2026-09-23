import { describe, expect, it } from 'vitest';
import { getPriceSnapshot, getTokenPriceUsd, KNOWN_SYMBOLS, priceAsDecimal } from '../src';

function fakeFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

  return { impl, calls };
}

const ETH = { price: 2628.32, symbol: 'ETH', timestamp: 1789767100, confidence: 0.99 };

describe('token prices', () => {
  it('looks up a known symbol by its DefiLlama coingecko slug', async () => {
    const { impl, calls } = fakeFetch(200, { coins: { 'coingecko:ethereum': ETH } });

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

/** The cost model: one upstream request serves every symbol and every caller. */
describe('the shared snapshot', () => {
  it('prices every curated token in a single request', async () => {
    const { impl, calls } = fakeFetch(200, { coins: {} });

    await getPriceSnapshot(impl);

    expect(calls).toHaveLength(1);
    for (const slug of new Set(Object.values(KNOWN_SYMBOLS))) {
      expect(calls[0]).toContain(`coingecko:${slug}`);
    }
  });

  it('answers many lookups, in parallel or in sequence, from that one request', async () => {
    const { impl, calls } = fakeFetch(200, { coins: { 'coingecko:ethereum': ETH } });

    await Promise.all([getTokenPriceUsd('ETH', impl), getTokenPriceUsd('BTC', impl), getTokenPriceUsd('ETH', impl)]);
    await getTokenPriceUsd('SOL', impl);

    expect(calls).toHaveLength(1);
  });

  it('names a shared slug by the symbol that was asked for', async () => {
    const { impl } = fakeFetch(200, {
      coins: { 'coingecko:polygon-ecosystem-token': { price: 0.1, symbol: 'POL', timestamp: 1, confidence: 0.99 } },
    });

    expect((await getTokenPriceUsd('MATIC', impl))?.symbol).toBe('MATIC');
    expect((await getTokenPriceUsd('POL', impl))?.symbol).toBe('POL');
  });

  it('does not cache a failure, so the next caller tries again', async () => {
    let fail = true;
    const impl = (async () =>
      fail ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ coins: { 'coingecko:ethereum': ETH } }))) as typeof fetch;

    await expect(getTokenPriceUsd('ETH', impl)).rejects.toThrow();
    fail = false;
    expect((await getTokenPriceUsd('ETH', impl))?.usd).toBe(2628.32);
  });
});

describe('priceAsDecimal', () => {
  const quote = { symbol: 'ETH', usd: 2628.3219, confidence: 0.99, asOf: '' };

  it('renders a price at the six-place USD scale', () => {
    expect(priceAsDecimal(quote)).toBe('2628.321900');
  });

  it('treats a missing, zero, negative or non-finite price as unpriced — never as free', () => {
    expect(priceAsDecimal(null)).toBeNull();
    expect(priceAsDecimal({ ...quote, usd: 0 })).toBeNull();
    expect(priceAsDecimal({ ...quote, usd: -1 })).toBeNull();
    expect(priceAsDecimal({ ...quote, usd: Number.NaN })).toBeNull();
    expect(priceAsDecimal({ ...quote, usd: Number.POSITIVE_INFINITY })).toBeNull();
  });
});
