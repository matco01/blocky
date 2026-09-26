import type { AcrossNativeSwapQuote, AcrossQuote, AcrossSwapQuote, CctpFees, GasZipQuote } from '@blocky/wallet-core';
import type {
  Address,
  ChainId,
  PreparedCall,
  RecipientRef,
  ResolvedRecipient,
  ResolvedToken,
  Simulation,
  TokenRef,
} from '@blocky/shared';

/**
 * Everything the planner needs from the outside world.
 *
 * The planner itself is pure: given this context and an Intent it produces the
 * same Plan every time. That is the same bargain `evaluatePolicy` and
 * `selectGasStrategy` already make, and it exists for the same reason — the
 * logic that decides what happens to someone's money should be testable
 * exhaustively, offline, in milliseconds.
 *
 * Everything that touches a chain, a price feed or a screening list lives
 * behind this interface. The viem-backed implementation is wired up in the API;
 * tests pass a fake.
 */
export interface PlannerContext {
  /**
   * Blocky's fee on swaps and moves out of Arc, or null for none. Where it
   * goes and how much is the server's configuration, never the model's.
   */
  blockyFee?(): { recipient: Address; bps: number } | null;

  /**
   * Resolve a token reference to a real contract.
   *
   * Null means "could not resolve" and produces a clarifying question, never a
   * guess. An ambiguous symbol is a null, not a best match.
   */
  resolveToken(ref: TokenRef, chainId: ChainId): Promise<ResolvedToken | null>;

  /** Resolve a recipient reference to an address. Null means unresolvable. */
  resolveRecipient(ref: RecipientRef): Promise<ResolvedRecipient | null>;

  /** USD price of one whole token, or null when we have no trustworthy price. */
  priceOf(token: ResolvedToken): Promise<string | null>;

  /** Spendable balance in the token's base units. */
  balanceOf(token: ResolvedToken): Promise<bigint>;

  /**
   * Spendable USDC on a chain, in USD.
   *
   * Separate from {@link balanceOf} because gas is taken in USDC — natively on
   * Arc, via Circle Paymaster elsewhere — whatever token the transaction moves.
   * Deriving it from the transferred token instead would report zero for every
   * non-USDC transfer and refuse perfectly payable transactions.
   */
  usdcBalanceUsd(chainId: ChainId): Promise<string>;

  /**
   * The chain's own gas token held there, valued in USD. Null when it cannot
   * be valued — no price, or no way to read that chain — which the gas rules
   * treat as "not enough", never as "probably fine".
   */
  nativeBalanceUsd(chainId: ChainId): Promise<string | null>;

  /** Estimated network fee in USD. Throws rather than guessing when it cannot be priced. */
  estimateNetworkFeeUsd(chainId: ChainId, calls: readonly PreparedCall[]): Promise<string>;

  /**
   * What Circle charges to move USDC between two chains and deliver it there.
   * Throws when the fee cannot be read, which the planner reports as "not
   * available right now" rather than planning a transfer it cannot price.
   */
  bridgeFees(from: ChainId, to: ChainId): Promise<CctpFees>;

  /**
   * An Across quote for moving exactly `inputAmount` of USDC to `recipient`
   * on another chain. Null when Across has no route for it. Throws when the
   * quote cannot be read; the planner then simply leaves Across out.
   */
  acrossQuote(from: ChainId, to: ChainId, inputAmount: bigint, recipient: Address): Promise<AcrossQuote | null>;

  /**
   * An Across quote for swapping exactly `inputAmount` of USDC into
   * `outputToken` on another chain — already checked field by field (see
   * `fetchAcrossSwapQuote`). Null when there is no route; throws when a quote
   * cannot be read or fails its checks, and the planner leaves Across out.
   */
  acrossSwapQuote(
    from: ChainId,
    to: ChainId,
    inputAmount: bigint,
    outputToken: Address,
    recipient: Address,
  ): Promise<AcrossSwapQuote | null>;

  /**
   * A Gas.zip quote for turning exactly `inputAmount` of USDC into the
   * destination's gas token. Null when Gas.zip has no route, no liquidity, or
   * the amount is over its limit.
   */
  gasZipQuote(from: ChainId, to: ChainId, inputAmount: bigint, recipient: Address): Promise<GasZipQuote | null>;

  /**
   * An Across quote for selling exactly `inputAmount` of the origin chain's
   * gas token for USDC delivered on another chain — how money swapped out to
   * another chain comes home. Already checked field by field (see
   * `fetchAcrossNativeSwapQuote`). Null when there is no route.
   */
  acrossNativeSwapQuote(
    from: ChainId,
    to: ChainId,
    inputAmount: bigint,
    recipient: Address,
    /** An ERC-20 to sell instead of the gas token — a stock. */
    inputToken?: Address,
  ): Promise<AcrossNativeSwapQuote | null>;

  /** Sanctions and known-scam screening. True means flagged. */
  isAddressFlagged(address: Address): Promise<boolean>;

  /**
   * Dry run. Never called by a plain transfer — there's no logic in an
   * ERC-20 transfer call that can fail beyond what the balance and gas checks
   * already cover, so simulating one would tell the user nothing about their
   * actual send. This exists for the swap path: a router call has real logic
   * (slippage, an allowance, a pool that's moved) that only a dry run catches.
   *
   * Optional because a plan is still useful without one — but when a caller
   * that needs it finds it absent, the plan should carry a
   * `simulation_failed` warning rather than quietly pretending the check
   * passed.
   */
  simulate?(chainId: ChainId, calls: readonly PreparedCall[]): Promise<Simulation>;
}

/**
 * Why a plan could not be built.
 *
 * These are distinct from warnings: a warning is something the user should see
 * before approving, a failure means there is nothing to approve. Each one is
 * phrased so the agent can say it out loud without translation.
 */
export type PlanFailureCode =
  | 'unknown_token'
  | 'unknown_recipient'
  | 'unpriced_amount'
  | 'insufficient_balance'
  | 'no_gas_route'
  | 'no_bridge_route'
  /** A swap that would lose too much to a thin market at this size. */
  | 'price_impact'
  | 'not_implemented';

export interface PlanFailure {
  code: PlanFailureCode;
  message: string;
}

export function fail(code: PlanFailureCode, message: string): { ok: false; failure: PlanFailure } {
  return { ok: false, failure: { code, message } };
}
