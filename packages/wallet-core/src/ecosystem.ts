/**
 * Live protocol/TVL data for Arc, so the agent can answer "what's popular on
 * Arc right now" — the same kind of read-only market context as `prices.ts`,
 * from the same free DefiLlama API.
 *
 * No APY or yield figure appears anywhere here, on purpose: DefiLlama has no
 * reliable yield data for Arc yet, and a wrong number stated with confidence
 * is worse than admitting we don't have one.
 */

import { cached } from './cache';

const API = 'https://api.llama.fi';

/** The full protocol list is megabytes; TVL rankings barely move within the hour. */
const PROTOCOLS_TTL_MS = 15 * 60_000;
const CHAIN = 'Arc';

/** Plenty to answer "what's popular", small enough to stay cheap in context. */
const MAX_RESULTS = 15;

export interface ArcProtocol {
  name: string;
  category: string;
  tvlUsd: number;
}

/**
 * The protocols DefiLlama tracks on Arc, ranked by TVL there.
 *
 * `chainTvls[CHAIN]` — never the top-level `tvl`, which is the protocol's
 * total across every chain it runs on, not what's actually on Arc.
 */
export function getArcProtocols(fetchImpl: typeof fetch = fetch): Promise<ArcProtocol[]> {
  return cached(fetchImpl, 'arc-protocols', PROTOCOLS_TTL_MS, () => fetchArcProtocols(fetchImpl));
}

async function fetchArcProtocols(fetchImpl: typeof fetch): Promise<ArcProtocol[]> {
  const response = await fetchImpl(`${API}/protocols`);

  if (!response.ok) {
    throw new Error(`Protocol request failed with ${response.status}`);
  }

  const body = (await response.json()) as Array<{
    name?: string;
    category?: string;
    chains?: string[];
    chainTvls?: Record<string, number>;
  }>;

  return body
    .filter((protocol) => protocol.chains?.includes(CHAIN))
    .map((protocol) => ({
      name: protocol.name ?? 'Unknown',
      category: protocol.category ?? 'Other',
      tvlUsd: protocol.chainTvls?.[CHAIN] ?? 0,
    }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, MAX_RESULTS);
}
