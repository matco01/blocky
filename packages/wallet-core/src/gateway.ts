import { formatUsd, parseUsd, type Address, type ChainId } from '@blocky/shared';
import { CHAINS } from './chains';

/**
 * Circle Gateway balances.
 *
 * Read-only for now. Gateway holds USDC a user has *deposited* into its wallet
 * contract, which is separate from the USDC sitting in their own wallet —
 * adding the two is not double counting. But Gateway funds are not spendable by
 * a plain transfer: moving them needs a burn intent and a `gatewayMint`, which
 * is not built yet. So this is reported alongside the spendable balance, never
 * folded into it. A balance the Send button cannot spend is a confirmation card
 * that fails.
 *
 * Request and response shapes verified against the live testnet API.
 */

export const GATEWAY_API = {
  testnet: 'https://gateway-api-testnet.circle.com/v1',
  mainnet: 'https://gateway-api.circle.com/v1',
} as const;

export interface GatewayBalance {
  chainId: ChainId;
  domain: number;
  /** USD decimal string. USDC is a dollar. */
  balanceUsd: string;
  /** Deposits Gateway has seen but not yet made available. */
  pendingUsd: string;
}

export interface GatewayBalances {
  totalUsd: string;
  perChain: GatewayBalance[];
}

interface ApiResponse {
  balances?: Array<{ domain: number; balance: string; pendingBatch?: string }>;
}

/**
 * Fetch a depositor's Gateway balances on every chain we have a verified domain
 * for.
 *
 * Throws on a network or API failure. The caller decides what "unavailable"
 * looks like — silently returning zero would tell the user their money is gone.
 */
export async function fetchGatewayBalances(
  depositor: Address,
  options: { testnet: boolean; fetch?: typeof fetch },
): Promise<GatewayBalances> {
  const doFetch = options.fetch ?? fetch;

  const chains = Object.values(CHAINS).filter(
    (chain) => chain.gateway && chain.testnet === options.testnet && chain.gatewayDomain !== null,
  );

  if (chains.length === 0) return { totalUsd: '0', perChain: [] };

  const response = await doFetch(`${options.testnet ? GATEWAY_API.testnet : GATEWAY_API.mainnet}/balances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: chains.map((chain) => ({ domain: chain.gatewayDomain, depositor })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Gateway balances request failed with ${response.status}`);
  }

  const body = (await response.json()) as ApiResponse;

  const perChain: GatewayBalance[] = [];
  let total = 0n;

  for (const entry of body.balances ?? []) {
    const chain = chains.find((c) => c.gatewayDomain === entry.domain);
    if (!chain) continue;

    // parseUsd rejects anything that is not a plain decimal, so a malformed
    // response throws here rather than being coerced into a number.
    const balance = parseUsd(entry.balance);
    const pending = parseUsd(entry.pendingBatch ?? '0');

    total += balance;
    perChain.push({
      chainId: chain.id,
      domain: entry.domain,
      balanceUsd: formatUsd(balance),
      pendingUsd: formatUsd(pending),
    });
  }

  return { totalUsd: formatUsd(total), perChain };
}
