/**
 * Live token prices.
 *
 * One request prices every token we know, and one cached copy serves everyone:
 * the snapshot below is fetched at most once per {@link SNAPSHOT_TTL_MS}
 * however many users, balance polls and agent questions ask for it. That is how
 * a wallet shows live prices without paying per lookup — the cost is one call
 * every half-minute, not one per user per token.
 *
 * What a price may be used for: reading out loud, valuing holdings, and sizing
 * a network fee paid in a chain's own gas token. What it must never be used
 * for is working out how much of something to *send* — that arrives from the
 * API as a float, and every amount that moves is bigint precisely so that a
 * float never touches it. {@link priceAsDecimal} is the one sanctioned
 * crossing, and it only feeds fee estimates and display values.
 */

import { cached } from './cache';

const API = 'https://coins.llama.fi/prices/current';

/** Short enough to feel live, long enough that the upstream call count is flat. */
export const SNAPSHOT_TTL_MS = 30_000;

/**
 * Symbols we can answer for, mapped to DefiLlama's coingecko-slug identifiers.
 *
 * Curated rather than a general search: guessing a slug for an unlisted
 * symbol risks quoting the wrong asset's price with complete confidence. An
 * unlisted symbol comes back as "no price available", never a guess.
 */
export const KNOWN_SYMBOLS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  EURC: 'euro-coin',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  // Polygon renamed MATIC to POL; the old slug no longer has a price.
  MATIC: 'polygon-ecosystem-token',
  POL: 'polygon-ecosystem-token',
  LINK: 'chainlink',
  ARB: 'arbitrum',
  OP: 'optimism',
  UNI: 'uniswap',
  AAVE: 'aave',
  LTC: 'litecoin',
  DOT: 'polkadot',
  SHIB: 'shiba-inu',
  TRX: 'tron',
  ATOM: 'cosmos',
  HYPE: 'hyperliquid',
};

export interface PriceQuote {
  symbol: string;
  /** USD per whole token, as the API returned it — see the note above on what it may be used for. */
  usd: number;
  /** How much the API trusts this price, 0–1. Below ~0.9 is worth a caveat. */
  confidence: number;
  asOf: string;
}

/** Every curated symbol's price, by upper-case symbol. A symbol the API had nothing for is simply absent. */
export type PriceSnapshot = ReadonlyMap<string, PriceQuote>;

/**
 * The shared snapshot. Throws on a network or API failure — the caller decides
 * what "unavailable" looks like, and it must not look like a price of zero.
 */
export function getPriceSnapshot(fetchImpl: typeof fetch = fetch): Promise<PriceSnapshot> {
  return cached(fetchImpl, 'price-snapshot', SNAPSHOT_TTL_MS, () => fetchSnapshot(fetchImpl));
}

/**
 * One token's price, or null when we don't curate the symbol or the API has
 * nothing for it. Never throws for an ordinary "don't know" — only for an
 * actual network failure, which means "temporarily unavailable", not "no such
 * token".
 */
export async function getTokenPriceUsd(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceQuote | null> {
  const key = symbol.trim().toUpperCase();
  if (!KNOWN_SYMBOLS[key]) return null;

  return (await getPriceSnapshot(fetchImpl)).get(key) ?? null;
}

/**
 * A quote as a USD decimal string, for fee estimates and display values only.
 *
 * Six places, matching the USD scale everything else uses. Null for anything
 * that is not a sane positive price, so a garbled response degrades to
 * "unpriced" instead of a fee of zero.
 */
export function priceAsDecimal(quote: PriceQuote | null): string | null {
  if (!quote || !Number.isFinite(quote.usd) || quote.usd <= 0) return null;
  const decimal = quote.usd.toFixed(6);
  // A price below a millionth of a dollar rounds to zero here, and zero is the
  // one answer that must never come out of this function.
  return /^0\.0+$/.test(decimal) ? null : decimal;
}

async function fetchSnapshot(fetchImpl: typeof fetch): Promise<PriceSnapshot> {
  const slugs = [...new Set(Object.values(KNOWN_SYMBOLS))];
  const response = await fetchImpl(`${API}/${slugs.map((slug) => `coingecko:${slug}`).join(',')}`);

  if (!response.ok) {
    throw new Error(`Price request failed with ${response.status}`);
  }

  const body = (await response.json()) as {
    coins?: Record<string, { price: number; symbol: string; timestamp: number; confidence: number }>;
  };

  const snapshot = new Map<string, PriceQuote>();

  for (const [symbol, slug] of Object.entries(KNOWN_SYMBOLS)) {
    const coin = body.coins?.[`coingecko:${slug}`];
    if (!coin) continue;

    snapshot.set(symbol, {
      // Our symbol, not the API's: POL and MATIC share a slug, and "what's
      // MATIC worth" should answer as MATIC.
      symbol,
      usd: coin.price,
      confidence: coin.confidence,
      asOf: new Date(coin.timestamp * 1000).toISOString(),
    });
  }

  return snapshot;
}
