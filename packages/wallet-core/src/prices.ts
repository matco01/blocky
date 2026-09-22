/**
 * Token prices, for the agent to answer "what's ETH worth" — not for the
 * planner, which still prices only USDC (a dollar, always) until a real feed
 * is wired into money-moving code in M5.
 *
 * That distinction matters: this value comes from a third-party API as a
 * floating-point number, sourced live off the wire. It is fine as something to
 * read out loud, and it must never be allowed anywhere near an amount that
 * gets sent — the whole rest of the codebase is bigint precisely to keep a
 * float from touching money, and this file is a deliberate, narrow exception
 * to that rule for exactly one purpose: display.
 */

import { cached } from './cache';

const API = 'https://coins.llama.fi/prices/current';

/** Prices move, but not enough in a minute to matter for something read out loud. */
const PRICE_TTL_MS = 60_000;

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
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  POL: 'matic-network',
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
};

export interface PriceQuote {
  symbol: string;
  /** USD per whole token, as the API returned it — display only, see above. */
  usd: number;
  /** How much the API trusts this price, 0–1. Below ~0.9 is worth a caveat. */
  confidence: number;
  asOf: string;
}

/**
 * Look up one token's price, or null when we don't recognise the symbol or
 * the API has nothing for it. Never throws for an ordinary "don't know" —
 * only for an actual network failure, which the caller should treat as
 * "temporarily unavailable" rather than "no such token".
 */
export async function getTokenPriceUsd(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceQuote | null> {
  const slug = KNOWN_SYMBOLS[symbol.trim().toUpperCase()];
  if (!slug) return null;

  return cached(fetchImpl, slug, PRICE_TTL_MS, () => fetchPrice(slug, fetchImpl));
}

async function fetchPrice(slug: string, fetchImpl: typeof fetch): Promise<PriceQuote | null> {
  const key = `coingecko:${slug}`;
  const response = await fetchImpl(`${API}/${key}`);

  if (!response.ok) {
    throw new Error(`Price request failed with ${response.status}`);
  }

  const body = (await response.json()) as {
    coins?: Record<string, { price: number; symbol: string; timestamp: number; confidence: number }>;
  };

  const coin = body.coins?.[key];
  if (!coin) return null;

  return {
    symbol: coin.symbol,
    usd: coin.price,
    confidence: coin.confidence,
    asOf: new Date(coin.timestamp * 1000).toISOString(),
  };
}
