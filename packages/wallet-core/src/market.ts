/**
 * The market at a glance: how big it is, where it moved, what people are
 * looking at. For "how's the market", "what's pumping", "what's trending" —
 * answered from data rather than a web search, which is slower, costs per
 * query, and reads prose written by strangers.
 *
 * One cached snapshot serves every user, like prices: at most three upstream
 * calls a minute however many ask. Market data to read out loud — never an
 * input to any amount that moves.
 *
 * Coin names and symbols here are chosen by whoever listed the coin. They are
 * data, and reach the agent fenced as untrusted like every tool result.
 */

import { cached } from './cache';

const API = 'https://api.coingecko.com/api/v3';

/** A minute: the market moves, but not in ways a chat reply needs by the second. */
export const MARKET_TTL_MS = 60_000;

/** Movers are picked from the largest coins only — a +900% microcap is noise, or a trap. */
const MOVERS_UNIVERSE = 100;

export interface MarketCoin {
  symbol: string;
  name: string;
  priceUsd: number | null;
  change24hPct: number | null;
}

export interface MarketOverview {
  asOf: string;
  /** Null when that part of the upstream failed; the rest still answers. */
  totalMarketCapUsd: number | null;
  marketCapChange24hPct: number | null;
  btcDominancePct: number | null;
  topByMarketCap: MarketCoin[];
  /** Best and worst 24h moves among the top {@link MOVERS_UNIVERSE} by market cap. */
  biggestGainers: MarketCoin[];
  biggestLosers: MarketCoin[];
  /** What people are searching for on CoinGecko right now. Attention, not quality. */
  trending: Array<{ symbol: string; name: string; marketCapRank: number | null }>;
}

export interface MarketOptions {
  fetch?: typeof fetch;
  /** A CoinGecko demo key raises the free rate limit. Optional. */
  apiKey?: string;
}

export function fetchMarketOverview(options: MarketOptions = {}): Promise<MarketOverview> {
  const fetchImpl = options.fetch ?? fetch;
  return cached(fetchImpl, 'market-overview', MARKET_TTL_MS, () => loadOverview(fetchImpl, options.apiKey));
}

async function loadOverview(fetchImpl: typeof fetch, apiKey: string | undefined): Promise<MarketOverview> {
  const get = async (path: string): Promise<any> => {
    const response = await fetchImpl(`${API}${path}`, {
      headers: { accept: 'application/json', ...(apiKey ? { 'x-cg-demo-api-key': apiKey } : {}) },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`CoinGecko ${path} failed: ${response.status}`);
    return response.json();
  };

  const [global, markets, trending] = await Promise.allSettled([
    get('/global'),
    get(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MOVERS_UNIVERSE}&page=1&price_change_percentage=24h`),
    get('/search/trending'),
  ]);

  if (global.status === 'rejected' && markets.status === 'rejected' && trending.status === 'rejected') {
    throw new Error('Market data is unavailable right now.');
  }

  const coins: MarketCoin[] =
    markets.status === 'fulfilled' && Array.isArray(markets.value)
      ? markets.value.map((coin: any) => ({
          symbol: String(coin.symbol ?? '').toUpperCase(),
          name: String(coin.name ?? ''),
          priceUsd: finite(coin.current_price),
          change24hPct: round(finite(coin.price_change_percentage_24h)),
        }))
      : [];
  const moved = coins.filter((coin) => coin.change24hPct !== null);
  const byChange = [...moved].sort((a, b) => b.change24hPct! - a.change24hPct!);

  const data = global.status === 'fulfilled' ? global.value?.data : null;

  return {
    asOf: new Date().toISOString(),
    totalMarketCapUsd: finite(data?.total_market_cap?.usd),
    marketCapChange24hPct: round(finite(data?.market_cap_change_percentage_24h_usd)),
    btcDominancePct: round(finite(data?.market_cap_percentage?.btc)),
    topByMarketCap: coins.slice(0, 10),
    biggestGainers: byChange.slice(0, 5).filter((coin) => coin.change24hPct! > 0),
    biggestLosers: byChange.slice(-5).reverse().filter((coin) => coin.change24hPct! < 0),
    trending:
      trending.status === 'fulfilled' && Array.isArray(trending.value?.coins)
        ? trending.value.coins.slice(0, 7).map(({ item }: any) => ({
            symbol: String(item?.symbol ?? '').toUpperCase(),
            name: String(item?.name ?? ''),
            marketCapRank: finite(item?.market_cap_rank),
          }))
        : [],
  };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
