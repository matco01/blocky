import {
  displayUsd,
  formatUnits,
  formatUsd,
  parseUsd,
  type AssetDelta,
  type BridgeIntent,
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
import {
  CCTP_FAST_FINALITY,
  CCTP_FORWARD_HOOK_DATA,
  DEFAULT_CHAIN,
  acrossSpokePool,
  canMoveUsdcBetween,
  canPayForGeneralAction,
  cctpArrivalForBurn,
  cctpContracts,
  getChain,
  selectGasStrategy,
} from '@blocky/wallet-core';
import { assetDelta, resolveAmount } from './amount';
import { acrossDepositCalls, cctpBurnCalls, erc20TransferCall } from './calls';
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

    case 'bridge':
      return planBridge(intent, ctx);

    /*
     * Swaps fail loudly rather than being half-built, for the same reason
     * `deriveSessionPermissions` throws on swap: a partial implementation of a
     * money-moving path is worse than an absent one, because it looks finished.
     */
    case 'swap':
      return fail('not_implemented', "Swaps aren't available yet.");
  }
}

/**
 * Every plan is signed on Arc today: the app's signer only talks to Arc, and a
 * plan it cannot sign is a confirmation card that fails at the last step.
 */
function onlyFromArc(chainId: ChainId): PlanOutcome | null {
  if (chainId === DEFAULT_CHAIN) return null;
  return fail('not_implemented', `Blocky can only move money from Arc right now, not from ${getChain(chainId).name}.`);
}

/* -------------------------------------------------------------------------- */
/*  Transfer                                                                   */
/* -------------------------------------------------------------------------- */

async function planTransfer(intent: TransferIntent, ctx: PlannerContext): Promise<PlanOutcome> {
  const chainId: ChainId = intent.chainId ?? DEFAULT_CHAIN;
  const chain = getChain(chainId);

  const notArc = onlyFromArc(chainId);
  if (notArc) return notArc;

  /* --- Resolve what the model only named ---------------------------------- */

  const [token, recipient] = await Promise.all([
    ctx.resolveToken(intent.token, chainId),
    ctx.resolveRecipient(intent.recipient),
  ]);

  if (!token) {
    return fail('unknown_token', describeUnknownToken(intent.token));
  }

  if (!recipient) {
    return fail('unknown_recipient', "I couldn't work out who that is. Give me an address or a saved contact.");
  }

  /* --- Work out how much ------------------------------------------------- */

  /*
   * The fee is estimated against a placeholder call, because the exact amount
   * does not change the gas cost of an ERC-20 transfer — the calldata is the
   * same length either way. That lets it run alongside the balance reads
   * rather than after them.
   */
  const probeCall = erc20TransferCall({
    chainId,
    token,
    to: recipient.address,
    amount: 0n,
    displayAmount: '0',
    recipientDisplay: recipient.display,
  });

  const [unitPrice, balance, usdcBalanceUsd, networkFeeUsd, flagged] = await Promise.all([
    ctx.priceOf(token),
    ctx.balanceOf(token),
    // Asked for independently of the token being sent: on Arc, gas is taken
    // in USDC whatever is moving.
    ctx.usdcBalanceUsd(chainId),
    ctx.estimateNetworkFeeUsd(chainId, [probeCall]),
    ctx.isAddressFlagged(recipient.address),
  ]);

  const isUsdc = token.address === chain.usdc;

  const gas = selectGasStrategy({ chainId, networkFeeUsd, usdcBalanceUsd, nativeBalanceUsd: null });

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

  const delta = assetDelta(token, amount.amount, unitPrice);

  const calls: PreparedCall[] = [
    erc20TransferCall({
      chainId,
      token,
      to: recipient.address,
      amount: amount.amount,
      displayAmount: delta.displayAmount,
      recipientDisplay: recipient.display,
    }),
  ];

  const fee = networkFee(gas.plan);

  const warnings: Warning[] = [
    ...recipientWarnings(recipient, flagged),
    ...tokenWarnings(token),
    ...feeWarnings(fee.totalUsd, delta.usdValue),
  ];

  return {
    ok: true,
    plan: stamp({
      intentType: 'transfer',
      summary: summariseTransfer(delta, recipient, fee),
      modelRationale: intent.rationale,
      outflow: [delta],
      inflow: [],
      recipient,
      fee,
      warnings,
      calls,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/*  Bridge: USDC from Arc to another chain, by the best route there is          */
/* -------------------------------------------------------------------------- */

/**
 * One way of getting the money there, fully priced: exactly what it delivers,
 * how long it takes, and the calls that do it.
 */
interface Route {
  provider: 'cctp' | 'across';
  /** What lands on the destination — the floor, for a route whose fee is a ceiling. */
  arrive: bigint;
  etaSeconds: number;
  feeIsCeiling: boolean;
  calls: PreparedCall[];
}

/** Slower routes only win by more than this: a few cents is not worth minutes of waiting. */
const SPEED_TIEBREAK_UNITS = 1_000n; // $0.001

async function planBridge(intent: BridgeIntent, ctx: PlannerContext): Promise<PlanOutcome> {
  const from: ChainId = intent.fromChainId ?? DEFAULT_CHAIN;
  const to = intent.toChainId;
  const source = getChain(from);
  const destination = getChain(to);

  const notArc = onlyFromArc(from);
  if (notArc) return notArc;

  if (from === to) {
    return fail('no_bridge_route', `That money is already on ${source.name}.`);
  }

  const cctp = canMoveUsdcBetween(from, to) ? cctpContracts(from) : null;
  const acrossPool = source.testnet === destination.testnet ? acrossSpokePool(from) : null;

  if (!cctp && !acrossPool) {
    return fail('no_bridge_route', `Blocky can't move money to ${destination.name} yet.`);
  }

  const [token, self] = await Promise.all([
    ctx.resolveToken(intent.token, from),
    ctx.resolveRecipient({ kind: 'self' }),
  ]);

  if (!token) {
    return fail('unknown_token', describeUnknownToken(intent.token));
  }

  // Every route moves USDC and nothing else — swaps are a different intent.
  if (token.address !== source.usdc) {
    return fail('not_implemented', `Only USDC can move between chains right now, not ${token.symbol}.`);
  }

  if (!self) {
    return fail('unknown_recipient', "Your wallet isn't ready yet. Try again in a moment.");
  }

  // Always the user's own address: moving money between chains is moving it
  // to yourself. Paying someone else on another chain is a different intent.
  const wallet = self.address;

  /* --- How much leaves ---------------------------------------------------- */

  // Every route is an approve plus one deposit, so one estimate sizes the gas
  // for all of them.
  const [balance, usdcBalanceUsd, networkFeeUsd, destinationGasUsd, destinationFeeUsd] = await Promise.all([
    ctx.balanceOf(token),
    ctx.usdcBalanceUsd(from),
    ctx.estimateNetworkFeeUsd(from, [probeCall(from, token), probeCall(from, token)]),
    // Only for the warning below — never a reason to refuse the move itself.
    ctx.nativeBalanceUsd(to).catch(() => null),
    ctx.estimateNetworkFeeUsd(to, []).catch(() => null),
  ]);

  const gas = selectGasStrategy({ chainId: from, networkFeeUsd, usdcBalanceUsd, nativeBalanceUsd: null });
  if (!gas.ok) {
    return fail('no_gas_route', gas.message);
  }

  // Arc gas comes out of the same USDC, so it stays behind whatever moves.
  // "Move $20" sends $20 and shows what arrives; "move everything" sends all
  // of it but the gas.
  const gasReserve = feeInTokenUnits(gas.plan.totalUsd, token, '1');
  const amount = resolveAmount({ spec: intent.amount, token, unitPrice: '1', balance, reserve: gasReserve });

  if (!amount.ok) {
    return fail(...amountFailure(amount.reason, token));
  }

  const input = amount.amount;
  const displayAmount = formatUnits(input, token.decimals);

  /* --- Price every route, keep the best ---------------------------------- */

  const [cctpFees, acrossQuote] = await Promise.all([
    cctp ? ctx.bridgeFees(from, to).catch(() => null) : null,
    acrossPool ? ctx.acrossQuote(from, to, input, wallet).catch(() => null) : null,
  ]);

  const routes: Route[] = [];

  if (cctp && cctpFees && destination.circleDomain !== null) {
    const priced = cctpArrivalForBurn(input, cctpFees);
    if (priced) {
      routes.push({
        provider: 'cctp',
        arrive: priced.arrive,
        etaSeconds: CCTP_ETA_SECONDS,
        feeIsCeiling: true,
        calls: cctpBurnCalls({
          chainId: from,
          token,
          messenger: cctp.tokenMessenger,
          burn: input,
          maxFee: priced.maxFee,
          destinationDomain: destination.circleDomain,
          recipient: wallet,
          hookData: CCTP_FORWARD_HOOK_DATA,
          minFinalityThreshold: CCTP_FAST_FINALITY,
          displayAmount,
          destinationName: destination.name,
        }),
      });
    }
  }

  if (acrossQuote && acrossQuote.inputAmount === input) {
    routes.push({
      provider: 'across',
      arrive: acrossQuote.outputAmount,
      etaSeconds: acrossQuote.etaSeconds,
      feeIsCeiling: false,
      calls: acrossDepositCalls({
        chainId: from,
        token,
        spokePool: acrossQuote.spokePool,
        depositor: wallet,
        outputToken: acrossQuote.outputToken,
        inputAmount: input,
        outputAmount: acrossQuote.outputAmount,
        destinationChainId: to,
        exclusiveRelayer: acrossQuote.exclusiveRelayer,
        quoteTimestamp: acrossQuote.quoteTimestamp,
        fillDeadline: acrossQuote.fillDeadline,
        exclusivityDeadline: acrossQuote.exclusivityDeadline,
        displayAmount,
        destinationName: destination.name,
      }),
    });
  }

  const route = bestRoute(routes);

  if (!route) {
    return fail(
      'no_bridge_route',
      input < 1_000_000n
        ? `That's too little to move to ${destination.name} — the transfer fee would take all of it.`
        : `Moving money to ${destination.name} isn't available right now. Try again in a minute.`,
    );
  }

  /* --- Build the plan ----------------------------------------------------- */

  const moved = assetDelta(token, input, '1');
  const landed = assetDelta({ ...token, chainId: to, address: destination.usdc }, route.arrive, '1');
  const transferFee = input - route.arrive;

  const fee: Fee = {
    totalUsd: formatUsd(parseUsd(gas.plan.totalUsd) + transferFee),
    paidIn: 'usdc',
    breakdown: { networkUsd: gas.plan.networkUsd, paymasterUsd: '0', serviceUsd: formatUsd(transferFee) },
  };

  const canActThere =
    destinationFeeUsd !== null &&
    canPayForGeneralAction({
      chainId: to,
      networkFeeUsd: destinationFeeUsd,
      usdcBalanceUsd: formatUsd(route.arrive),
      nativeBalanceUsd: destinationGasUsd,
    });

  const warnings: Warning[] = [
    ...feeWarnings(fee.totalUsd, moved.usdValue),
    ...destinationWarnings({
      chainName: destination.name,
      gasToken: destination.nativeCurrency.symbol,
      canActThere,
    }),
  ];

  return {
    ok: true,
    plan: stamp({
      intentType: 'bridge',
      summary: summariseBridge(moved, landed, destination.name, route),
      modelRationale: intent.rationale,
      outflow: [moved],
      inflow: [landed],
      // Your own wallet, on another chain: there is no third party to vet.
      recipient: null,
      fee,
      warnings,
      calls: route.calls,
      route: { provider: route.provider, etaSeconds: route.etaSeconds, feeIsCeiling: route.feeIsCeiling },
    }),
  };
}

/** CCTP Fast Transfers with forwarding land in well under a minute. */
const CCTP_ETA_SECONDS = 30;

/**
 * The route that delivers the most. A slower route has to deliver more than
 * a rounding error extra to win; between two that deliver the same, the
 * faster one does.
 */
export function bestRoute<T extends { arrive: bigint; etaSeconds: number }>(routes: readonly T[]): T | null {
  let best: T | null = null;

  for (const route of routes) {
    if (route.arrive <= 0n) continue;
    if (!best) {
      best = route;
      continue;
    }

    const faster = route.etaSeconds < best.etaSeconds;
    const margin = faster ? -SPEED_TIEBREAK_UNITS : SPEED_TIEBREAK_UNITS;
    if (route.arrive > best.arrive + margin) best = route;
  }

  return best;
}

/** A stand-in call, for sizing gas before the amounts are known. */
function probeCall(chainId: ChainId, token: ResolvedToken): PreparedCall {
  return { chainId, to: token.address, data: '0x', value: '0', description: 'Gas estimate' };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The parts every plan shares: an id, a price window, and no dry run. */
function stamp(plan: Omit<Plan, 'id' | 'simulation' | 'createdAt' | 'expiresAt'>): Plan {
  const now = new Date();

  return {
    id: crypto.randomUUID(),
    ...plan,
    /*
     * Neither a plain ERC-20 transfer nor a CCTP burn dry-runs: both are fixed
     * calls to known contracts, and the balance and gas checks above already
     * cover how they can fail. `ctx.simulate` is for the swap path, where a
     * router, slippage or an allowance can revert in ways only a dry run
     * catches.
     */
    simulation: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
  };
}

function networkFee(gas: { mode: Fee['paidIn']; totalUsd: string; networkUsd: string }): Fee {
  return {
    totalUsd: gas.totalUsd,
    paidIn: gas.mode,
    breakdown: { networkUsd: gas.networkUsd, paymasterUsd: '0', serviceUsd: '0' },
  };
}

/**
 * The headline on the confirmation card.
 *
 * Computed here from resolved facts, deliberately independent of anything the
 * model wrote. The user sees this next to `modelRationale`, so a model that has
 * misunderstood the request produces a visible mismatch rather than a
 * convincing story.
 */
function summariseTransfer(outflow: AssetDelta, recipient: ResolvedRecipient, fee: Fee): string {
  const value = outflow.usdValue === null ? '' : ` (${displayUsd(outflow.usdValue)})`;
  const cost = parseUsd(fee.totalUsd) === 0n ? 'No fee' : `${displayUsd(fee.totalUsd)} fee`;

  return `Send ${outflow.displayAmount} ${outflow.token.symbol}${value} to ${recipient.display}. ${cost}.`;
}

/**
 * "Move $20.00 to your wallet on Base. $19.99 arrives in about 2 seconds." A
 * route whose fee is a ceiling says "at least": whatever it doesn't use
 * arrives too.
 */
function summariseBridge(moved: AssetDelta, landed: AssetDelta, destinationName: string, route: Route): string {
  const arrives = `${route.feeIsCeiling ? 'At least ' : ''}${displayUsd(landed.usdValue ?? '0')} arrives`;
  return `Move ${displayUsd(moved.usdValue ?? '0')} to your wallet on ${destinationName}. ${arrives} in ${describeEta(route.etaSeconds)}.`;
}

function describeEta(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

function describeUnknownToken(token: TransferIntent['token']): string {
  return token.kind === 'symbol'
    ? `I couldn't find a token called ${token.symbol}.`
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
