import { formatUsd, parseUsd, type ChainId } from '@blocky/shared';
import { getChain } from './chains';

/**
 * Gas strategy.
 *
 * Our users hold USDC. Most EVM chains want gas in something else. This decides
 * how that is reconciled, and it cannot be reconciled by the agent being
 * clever: a transaction nobody can pay gas for does not broadcast.
 *
 * In order of preference:
 *
 *  1. **Native USDC gas (Arc).** Gas is paid in USDC from the same balance being
 *     spent. No paymaster, no surcharge, no third party. This is why Arc is the
 *     home chain.
 *  2. **Circle Paymaster** (Base, Arbitrum). Gas deducted in USDC from the
 *     transaction itself, plus Circle's 10% surcharge.
 *  3. **Native token**, if the account happens to hold some. A fallback that
 *     should be vanishingly rare.
 *
 * What is deliberately *not* here, because it was wrong in an earlier version:
 *
 *  - "Gateway transfers are gas-free." They are not. A Gateway transfer ends in
 *    a `gatewayMint` on the destination chain, and someone pays for it. And a
 *    same-chain send is not a Gateway operation at all — it is a plain ERC-20
 *    transfer.
 *  - "Circle Gas Station sponsors onboarding." Gas Station sponsors Circle's own
 *    wallets, not an arbitrary smart account. A `sponsored` tier comes back
 *    only when a sponsoring paymaster is actually integrated — a tier that
 *    promises $0 fees with nothing behind it produces plans that fail on-chain.
 */

/** Circle Paymaster's surcharge on Base and Arbitrum, in basis points. */
export const PAYMASTER_SURCHARGE_BPS = 1000n; // 10%

export type GasMode = 'sponsored' | 'usdc' | 'native';

export interface GasContext {
  chainId: ChainId;
  /** Estimated network fee in USD, before any surcharge. */
  networkFeeUsd: string;
  /** Spendable USDC, in USD. */
  usdcBalanceUsd: string;
  /** Whether the account holds any native token (on Arc, native *is* USDC). */
  hasNativeBalance: boolean;
}

export interface GasPlan {
  mode: GasMode;
  /** What the user is charged, all-in. The only number the UI may show. */
  totalUsd: string;
  networkUsd: string;
  /** Surcharge, folded into `totalUsd`. Never shown as its own line. */
  paymasterUsd: string;
  /** Internal explanation for logs and support, not for the UI. */
  reason: string;
}

export type GasResult =
  | { ok: true; plan: GasPlan }
  | { ok: false; code: 'no_gas_route'; message: string };

/**
 * Work out who pays for gas and how much the user sees.
 *
 * Pure and synchronous — every input is resolved by the caller — so the tier
 * logic can be tested exhaustively without a chain.
 */
export function selectGasStrategy(ctx: GasContext): GasResult {
  const chain = getChain(ctx.chainId);
  const network = parseUsd(ctx.networkFeeUsd);
  const usdc = parseUsd(ctx.usdcBalanceUsd);

  // Tier 1: the chain takes gas in USDC directly.
  if (chain.gasPaidInUsdc) {
    if (usdc >= network) {
      return {
        ok: true,
        plan: {
          mode: 'usdc',
          totalUsd: formatUsd(network),
          networkUsd: formatUsd(network),
          paymasterUsd: '0',
          reason: `${chain.name}: gas paid natively in USDC`,
        },
      };
    }

    // On a USDC-gas chain there is no other currency to fall back to.
    return noRoute();
  }

  // Tier 2: Circle Paymaster takes gas in USDC out of the transaction.
  if (chain.paymaster) {
    const surcharge = (network * PAYMASTER_SURCHARGE_BPS) / 10_000n;
    const total = network + surcharge;

    if (usdc >= total) {
      return {
        ok: true,
        plan: {
          mode: 'usdc',
          totalUsd: formatUsd(total),
          networkUsd: formatUsd(network),
          paymasterUsd: formatUsd(surcharge),
          reason: 'Circle Paymaster, gas deducted in USDC',
        },
      };
    }
  }

  // Last resort: the account happens to hold native token.
  if (ctx.hasNativeBalance) {
    return {
      ok: true,
      plan: {
        mode: 'native',
        totalUsd: formatUsd(network),
        networkUsd: formatUsd(network),
        paymasterUsd: '0',
        reason: `Fallback: paying gas in ${chain.nativeCurrency.symbol}`,
      },
    };
  }

  return noRoute();
}

/*
 * Say so plainly rather than letting a transaction fail at broadcast — "add a
 * little USDC" is a fixable instruction; "transaction underpriced" is not.
 */
function noRoute(): GasResult {
  return {
    ok: false,
    code: 'no_gas_route',
    message: 'Not enough USDC to cover the network fee. Add a little and try again.',
  };
}

/**
 * Can this account do anything at all on this chain?
 *
 * Used for the destination-gas warning: USDC that lands on a chain with neither
 * USDC gas nor Circle Paymaster can be received but not spent by someone who
 * holds no native token there.
 *
 * Implemented by asking {@link selectGasStrategy} rather than re-listing which
 * chains have which gas route. Two copies of that rule would eventually
 * disagree, and the wrong copy would be this one, because nobody runs it in
 * production.
 */
export function canPayForGeneralAction(ctx: GasContext): boolean {
  return selectGasStrategy(ctx).ok;
}
