import { formatUsd, parseUsd, type ChainId } from '@blocky/shared';
import { getChain } from './chains';

/**
 * Gas strategy.
 *
 * Our users hold USDC and no native token. EVM gas must be paid in native
 * token. That contradiction is resolved here, and it cannot be resolved by the
 * agent being clever: a wallet with zero ETH cannot broadcast a transaction, no
 * matter how well it reasons about wanting to.
 *
 * Three tiers, in order of preference:
 *
 *  1. `sponsored` — Circle Gateway's gas-free USDC path. No paymaster at all.
 *     This covers the most common action in the app, a plain USDC send.
 *  2. `sponsored` — Circle Gas Station, for a new user's first few actions, so
 *     onboarding works at a literal zero balance.
 *  3. `usdc` — Circle Paymaster deducts gas in USDC from the transaction
 *     itself. This is what "gas is included in the transaction" actually means.
 *
 * `native` exists only as a last-resort fallback and should be vanishingly
 * rare; if it starts showing up in production, something upstream is broken.
 */

/** Circle Paymaster's surcharge on Base and Arbitrum, in basis points. */
export const PAYMASTER_SURCHARGE_BPS = 1000n; // 10%

/** How many transactions we sponsor outright for a brand-new user. */
export const ONBOARDING_SPONSORED_TX_COUNT = 5;

export type GasMode = 'sponsored' | 'usdc' | 'native';

export interface GasContext {
  chainId: ChainId;
  /**
   * True when the whole action is a USDC movement that Gateway can settle on
   * its gas-free path — no swap, no arbitrary contract call.
   */
  isGatewayNativeTransfer: boolean;
  /** Agent- and user-initiated transactions this account has already made. */
  lifetimeTxCount: number;
  /** Estimated network fee in USD, before any surcharge. */
  networkFeeUsd: string;
  /** Spendable USDC, in USD. */
  usdcBalanceUsd: string;
  /** Whether the account holds any native token at all. */
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

  // Tier 1: Gateway settles plain USDC movement without gas.
  if (ctx.isGatewayNativeTransfer && chain.gateway) {
    return {
      ok: true,
      plan: {
        mode: 'sponsored',
        totalUsd: '0',
        networkUsd: '0',
        paymasterUsd: '0',
        reason: 'Circle Gateway gas-free USDC transfer',
      },
    };
  }

  // Tier 2: we eat the gas for a new user's first few actions.
  if (ctx.lifetimeTxCount < ONBOARDING_SPONSORED_TX_COUNT) {
    return {
      ok: true,
      plan: {
        mode: 'sponsored',
        totalUsd: '0',
        networkUsd: formatUsd(network),
        paymasterUsd: '0',
        reason: `Circle Gas Station onboarding sponsorship (${ctx.lifetimeTxCount + 1} of ${ONBOARDING_SPONSORED_TX_COUNT})`,
      },
    };
  }

  // Tier 3: the user pays, in USDC, out of the transaction itself.
  if (chain.paymaster) {
    const surcharge = (network * PAYMASTER_SURCHARGE_BPS) / 10_000n;
    const total = network + surcharge;

    if (parseUsd(ctx.usdcBalanceUsd) >= total) {
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

  /*
   * Nothing worked. Say so plainly rather than letting a transaction fail at
   * broadcast — "add a little USDC" is a fixable instruction; "transaction
   * underpriced" is not.
   */
  return {
    ok: false,
    code: 'no_gas_route',
    message: 'Not enough USDC to cover the network fee. Add a little and try again.',
  };
}
