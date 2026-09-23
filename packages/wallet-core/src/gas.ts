import { formatUsd, parseUsd, type ChainId } from '@blocky/shared';
import { getChain } from './chains';

/**
 * Gas strategy.
 *
 * Our users hold USDC. Most EVM chains want gas in something else. This decides
 * how that is reconciled, and it cannot be reconciled by the agent being
 * clever: a transaction nobody can pay gas for does not broadcast.
 *
 * There are exactly two routes, and nobody but the user pays for either:
 *
 *  1. **Arc: gas in USDC.** Arc's native currency is USDC, so gas comes out of
 *     the same balance being spent. No paymaster, no surcharge, no third party.
 *     This is why Arc is the home chain.
 *  2. **Anywhere else: the chain's own gas token.** ETH on Base, POL on
 *     Polygon. The user either holds enough of it there or they cannot act
 *     there, and the honest thing is to say so — "get a little ETH on Base
 *     first" is advice they can follow; a transaction that fails at broadcast
 *     is not.
 *
 * What is deliberately *not* here:
 *
 *  - **Sponsorship.** Blocky pays nobody's fees. A sponsored tier needs a
 *    funded paymaster and a business model behind it; a plan that promises $0
 *    with neither fails on-chain.
 *  - **Circle Paymaster.** It takes gas in USDC plus a 10% surcharge, on a
 *    handful of chains. Rather than a third fee model that only works in some
 *    places, a user who wants to act on another chain gets that chain's gas
 *    token when they move money there — see the destination warnings in the
 *    planner.
 *  - "Gateway transfers are gas-free." They are not: a Gateway transfer ends
 *    in a `gatewayMint` on the destination chain, and someone pays for it.
 */

export type GasMode = 'usdc' | 'native';

export interface GasContext {
  chainId: ChainId;
  /** Estimated network fee in USD. */
  networkFeeUsd: string;
  /** Spendable USDC, in USD. */
  usdcBalanceUsd: string;
  /**
   * The chain's native gas token held there, valued in USD. Null when it
   * cannot be valued — no price, or no way to read that chain — which counts
   * as "not enough", never as "probably fine". Unused on Arc, where native is
   * the USDC balance above.
   */
  nativeBalanceUsd: string | null;
}

export interface GasPlan {
  mode: GasMode;
  /** What the user is charged, all-in. The only number the UI may show. */
  totalUsd: string;
  networkUsd: string;
}

export type GasResult =
  | { ok: true; plan: GasPlan }
  | { ok: false; code: 'no_gas_route'; message: string };

/**
 * Work out how gas gets paid and how much the user sees.
 *
 * Pure and synchronous — every input is resolved by the caller — so the rule
 * can be tested exhaustively without a chain.
 */
export function selectGasStrategy(ctx: GasContext): GasResult {
  const chain = getChain(ctx.chainId);
  const network = parseUsd(ctx.networkFeeUsd);
  const fee = { totalUsd: formatUsd(network), networkUsd: formatUsd(network) };

  if (chain.gasPaidInUsdc) {
    if (parseUsd(ctx.usdcBalanceUsd) >= network) return { ok: true, plan: { mode: 'usdc', ...fee } };

    return {
      ok: false,
      code: 'no_gas_route',
      message: 'Not enough USDC to cover the network fee. Add a little and try again.',
    };
  }

  if (ctx.nativeBalanceUsd !== null && parseUsd(ctx.nativeBalanceUsd) >= network) {
    return { ok: true, plan: { mode: 'native', ...fee } };
  }

  const token = chain.nativeCurrency.symbol;
  return {
    ok: false,
    code: 'no_gas_route',
    message: `Fees on ${chain.name} are paid in ${token}, and there isn't enough ${token} in your wallet there. Get a little ${token} on ${chain.name} first.`,
  };
}

/**
 * Can this account do anything at all on this chain?
 *
 * Used for the destination warning: USDC that lands on a chain where the user
 * holds no gas token can be received there but not moved again.
 *
 * Implemented by asking {@link selectGasStrategy} rather than re-listing which
 * chains take which gas. Two copies of that rule would eventually disagree.
 */
export function canPayForGeneralAction(ctx: GasContext): boolean {
  return selectGasStrategy(ctx).ok;
}
