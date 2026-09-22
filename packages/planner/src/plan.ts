import {
  displayUsd,
  formatUnits,
  parseUsd,
  type AssetDelta,
  type ChainId,
  type Fee,
  type Intent,
  type Plan,
  type PreparedCall,
  type ResolvedRecipient,
  type ResolvedToken,
  type TransferIntent,
  type Warning,
} from '@blocky/shared';
import { DEFAULT_CHAIN, canPayForGeneralAction, getChain, selectGasStrategy } from '@blocky/wallet-core';
import { assetDelta, resolveAmount } from './amount';
import { erc20TransferCall } from './calls';
import { fail, type PlanFailure, type PlannerContext } from './context';
import { destinationWarnings, feeWarnings, recipientWarnings, tokenWarnings } from './warnings';

/**
 * Intent in, Plan out.
 *
 * This is the deterministic half of the system. The model said what the user
 * wants; everything from here is our own code reading real state and doing
 * arithmetic. Where the two disagree, the Plan wins and the user sees both —
 * which is why `modelRationale` is carried through unchanged rather than
 * being rewritten into the summary.
 */

/**
 * How long a plan's quotes stay good.
 *
 * Short, because a fee estimate is a measurement of a moving thing. The client
 * counts down and re-plans; an expired plan degrades to confirmation in
 * `evaluatePolicy` rather than executing on a stale number.
 */
export const PLAN_TTL_MS = 60_000;

export type PlanOutcome = { ok: true; plan: Plan } | { ok: false; failure: PlanFailure };

export async function buildPlan(intent: Intent, ctx: PlannerContext): Promise<PlanOutcome> {
  switch (intent.type) {
    case 'transfer':
      return planTransfer(intent, ctx);

    /*
     * Swaps and bridges are M5. They fail loudly rather than being half-built,
     * for the same reason `deriveSessionPermissions` throws on swap: a partial
     * implementation of a money-moving path is worse than an absent one,
     * because it looks finished.
     */
    case 'swap':
      return fail('not_implemented', "Swaps aren't available yet.");

    case 'bridge':
      return fail('not_implemented', "Moving funds between chains isn't available yet.");
  }
}

/* -------------------------------------------------------------------------- */
/*  Transfer                                                                   */
/* -------------------------------------------------------------------------- */

async function planTransfer(intent: TransferIntent, ctx: PlannerContext): Promise<PlanOutcome> {
  const chainId: ChainId = intent.chainId ?? DEFAULT_CHAIN;
  const chain = getChain(chainId);

  /* --- Resolve what the model only named ---------------------------------- */

  const token = await ctx.resolveToken(intent.token, chainId);

  if (!token) {
    return fail(
      'unknown_token',
      describeUnknownToken(intent),
    );
  }

  const recipient = await ctx.resolveRecipient(intent.recipient);

  if (!recipient) {
    return fail('unknown_recipient', "I couldn't work out who that is. Give me an address or a saved contact.");
  }

  /* --- Work out how much ------------------------------------------------- */

  const [unitPrice, balance, hasNative, usdcBalanceUsd] = await Promise.all([
    ctx.priceOf(token),
    ctx.balanceOf(token),
    ctx.hasNativeBalance(chainId),
    // Asked for independently of the token being sent: gas is taken in USDC
    // whatever is moving.
    ctx.usdcBalanceUsd(chainId),
  ]);

  /*
   * "Send everything" has to leave room for the fee when the fee comes out of
   * the same token. Estimated against a placeholder call, because the exact
   * amount does not change the gas cost of an ERC-20 transfer — the calldata is
   * the same length either way.
   */
  const isUsdc = token.address === chain.usdc;
  const probeCall = erc20TransferCall({
    chainId,
    token,
    to: recipient.address,
    amount: balance,
    displayAmount: formatUnits(balance, token.decimals),
    recipientDisplay: recipient.display,
  });

  const networkFeeUsd = await ctx.estimateNetworkFeeUsd(chainId, [probeCall]);

  const gasContext = {
    chainId,
    networkFeeUsd,
    usdcBalanceUsd,
    hasNativeBalance: hasNative,
  };

  const gas = selectGasStrategy(gasContext);

  if (!gas.ok) {
    return fail('no_gas_route', gas.message);
  }

  /*
   * When the fee comes out of the token being sent, it has to fit alongside the
   * amount — for every kind of amount, not only "max". On Arc that is every USDC
   * send. Without this, "send my last $10" passes planning with a balance of
   * exactly $10 and then fails on-chain, having looked fine on the card.
   */
  const reserve =
    gas.plan.mode === 'usdc' && isUsdc && unitPrice !== null
      ? feeInTokenUnits(gas.plan.totalUsd, token, unitPrice)
      : 0n;

  const amount = resolveAmount({ spec: intent.amount, token, unitPrice, balance, reserve });

  if (!amount.ok) {
    return fail(...amountFailure(amount.reason, token));
  }

  /* --- Build the transaction --------------------------------------------- */

  const outflow: AssetDelta[] = [assetDelta(token, amount.amount, unitPrice)];

  const calls: PreparedCall[] = [
    erc20TransferCall({
      chainId,
      token,
      to: recipient.address,
      amount: amount.amount,
      displayAmount: outflow[0]?.displayAmount ?? '0',
      recipientDisplay: recipient.display,
    }),
  ];

  const flagged = await ctx.isAddressFlagged(recipient.address);

  const fee: Fee = {
    totalUsd: gas.plan.totalUsd,
    paidIn: gas.plan.mode,
    breakdown: {
      networkUsd: gas.plan.networkUsd,
      paymasterUsd: gas.plan.paymasterUsd,
      serviceUsd: '0',
    },
  };

  const warnings: Warning[] = [
    ...recipientWarnings(recipient, flagged),
    ...tokenWarnings(token),
    ...feeWarnings(fee.totalUsd, outflow[0]?.usdValue ?? null),
    ...destinationWarnings({
      chainName: chain.name,
      canActThere: canPayForGeneralAction(gasContext),
      // An outbound transfer hands the money to someone else — whether they can
      // act on that chain is their business, not a warning for our user.
      isOutboundTransfer: intent.recipient.kind !== 'self',
    }),
  ];

  const now = new Date();

  return {
    ok: true,
    plan: {
      id: crypto.randomUUID(),
      intentType: 'transfer',
      summary: summarise(outflow[0], recipient, fee),
      modelRationale: intent.rationale,
      outflow,
      inflow: [],
      recipient,
      fee,
      warnings,
      calls,
      /*
       * A plain ERC-20 transfer never dry-runs, whether or not the context can
       * simulate: nothing in a transfer call can fail in a way the balance and
       * gas checks above haven't covered. `ctx.simulate` is for the swap path,
       * where a router, slippage or an allowance can revert in ways only a dry
       * run catches.
       */
      simulation: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The headline on the confirmation card.
 *
 * Computed here from resolved facts, deliberately independent of anything the
 * model wrote. The user sees this next to `modelRationale`, so a model that has
 * misunderstood the request produces a visible mismatch rather than a
 * convincing story.
 */
function summarise(
  outflow: AssetDelta | undefined,
  recipient: ResolvedRecipient,
  fee: Fee,
): string {
  if (!outflow) return 'Nothing to send';

  const value = outflow.usdValue === null ? '' : ` (${displayUsd(outflow.usdValue)})`;
  const cost = parseUsd(fee.totalUsd) === 0n ? 'No fee' : `${displayUsd(fee.totalUsd)} fee`;

  return `Send ${outflow.displayAmount} ${outflow.token.symbol}${value} to ${recipient.display}. ${cost}.`;
}

function describeUnknownToken(intent: TransferIntent): string {
  return intent.token.kind === 'symbol'
    ? `I couldn't find a token called ${intent.token.symbol}.`
    : "I couldn't find that token contract.";
}

function amountFailure(
  reason: 'unpriced' | 'invalid' | 'insufficient',
  token: ResolvedToken,
): ['unpriced_amount' | 'insufficient_balance', string] {
  switch (reason) {
    case 'unpriced':
      return [
        'unpriced_amount',
        `I don't have a reliable price for ${token.symbol}, so I can't work out what that is in dollars. Tell me the amount in ${token.symbol} instead.`,
      ];
    case 'insufficient':
      return ['insufficient_balance', `You don't have that much ${token.symbol}.`];
    case 'invalid':
      return ['insufficient_balance', `That isn't a valid amount of ${token.symbol}.`];
  }
}

/**
 * Convert a USD fee back into base units of the token it will be taken from.
 *
 * Rounds up. A reserve that is one unit short is a transaction that fails.
 */
function feeInTokenUnits(feeUsd: string, token: ResolvedToken, unitPrice: string): bigint {
  const price = parseUsd(unitPrice);
  if (price === 0n) return 0n;

  const numerator = parseUsd(feeUsd) * 10n ** BigInt(token.decimals);

  return (numerator + price - 1n) / price;
}
