import { describe, expect, it } from 'vitest';
import { fetchMarketOverview } from '../src/market';

/** A fake CoinGecko: each path answers from `routes`, or fails. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const path = Object.keys(routes).find((key) => url.includes(key));
    if (!path) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as unknown as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const coin = (symbol: string, change: number | null, price = 1) => ({
  symbol: symbol.toLowerCase(),
  name: symbol,
  current_price: price,
  price_change_percentage_24h: change,
});

const GLOBAL = {
  data: {
    total_market_cap: { usd: 2_884_455_563_105.77 },
    market_cap_change_percentage_24h_usd: -1.2345,
    market_cap_percentage: { btc: 58.4321 },
  },
};

const MARKETS = [coin('BTC', -0.6, 83826), coin('ETH', 2.5, 2600), coin('SOL', 9.9), coin('DOGE', -7.1), coin('XRP', null)];

const TRENDING = { coins: [{ item: { symbol: 'trump', name: 'Official Trump', market_cap_rank: 103 } }] };

describe('the market overview', () => {
  it('summarises size, movers and what is trending', async () => {
    const overview = await fetchMarketOverview({
      fetch: fakeFetch({ '/global': GLOBAL, '/coins/markets': MARKETS, '/search/trending': TRENDING }),
    });

    expect(overview.totalMarketCapUsd).toBe(2_884_455_563_105.77);
    expect(overview.marketCapChange24hPct).toBe(-1.23);
    expect(overview.btcDominancePct).toBe(58.43);
    expect(overview.topByMarketCap[0]).toEqual({ symbol: 'BTC', name: 'BTC', priceUsd: 83826, change24hPct: -0.6 });
    expect(overview.biggestGainers.map((c) => c.symbol)).toEqual(['SOL', 'ETH']);
    expect(overview.biggestLosers.map((c) => c.symbol)).toEqual(['DOGE', 'BTC']);
    expect(overview.trending).toEqual([{ symbol: 'TRUMP', name: 'Official Trump', marketCapRank: 103 }]);
  });

  it('still answers with what it has when part of the upstream fails', async () => {
    const overview = await fetchMarketOverview({ fetch: fakeFetch({ '/coins/markets': MARKETS }) });

    expect(overview.totalMarketCapUsd).toBeNull();
    expect(overview.trending).toEqual([]);
    expect(overview.topByMarketCap).toHaveLength(5);
  });

  it('fails when nothing answers, rather than reporting an empty market', async () => {
    await expect(fetchMarketOverview({ fetch: fakeFetch({}) })).rejects.toThrow(/unavailable/);
  });

  it('serves everyone from one snapshot', async () => {
    const fetchImpl = fakeFetch({ '/global': GLOBAL, '/coins/markets': MARKETS, '/search/trending': TRENDING });

    await Promise.all([fetchMarketOverview({ fetch: fetchImpl }), fetchMarketOverview({ fetch: fetchImpl })]);
    await fetchMarketOverview({ fetch: fetchImpl });

    expect(fetchImpl.calls).toHaveLength(3);
  });
});
