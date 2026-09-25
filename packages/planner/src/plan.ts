import {
  displayUsd,
  formatUnits,
  type Address,
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
  NATIVE_TOKEN,
  acrossPeriphery,
  acrossSpokePool,
  acrossSwapHandler,
  canMoveUsdcBetween,
  canPayForGeneralAction,
  cctpArrivalForBurn,
  cctpContracts,
  encodeGasZipDeposit,
  gasZipDepositContract,
  gasZipShortId,
  getChain,
  selectGasStrategy,
} from '@blocky/wallet-core';
import { assetDelta, resolveAmount } from './amount';
import { acrossDepositCalls, acrossSwapCalls, cctpBurnCalls, erc20TransferCall, gasZipDepositCall } from './calls';
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
/*  Bridge: USDC from Arc to another chain — as USDC, or swapped on arrival     */
/* -------------------------------------------------------------------------- */

/**
 * One way of getting the money there, fully priced: what it delivers, how long
 * it takes, and the calls that do it.
 */
interface Route {
  provider: string;
  /** What lands, in the received token's base units — the floor, where the fee is a ceiling. */
  arrive: bigint;
  /** For a swap: the least that can land before it reverts and refunds the USDC. */
  minimum?: bigint;
  etaSeconds: number;
  feeIsCeiling: boolean;
  calls: PreparedCall[];
}

/** Slower routes only win by more than this: a rounding error is not worth minutes of waiting. */
const SPEED_TIEBREAK_UNITS = 1_000n; // $0.001 of USDC

/** Gas for a swap-and-bridge, in ordinary calls' worth — see where it's used. */
const SWAP_AND_BRIDGE_CALLS = 5;

/** CCTP Fast Transfers with forwarding land in well under a minute. */
const CCTP_ETA_SECONDS = 30;

/**
 * A gas top-up buys roughly this many ordinary transactions on the
 * destination, within these bounds (USD, 6 decimals): enough to move the money
 * again a few times, small enough not to matter if it goes unused.
 */
const TOP_UP_TRANSACTIONS = 20n;
const TOP_UP_MIN_UNITS = 1_000_000n; // $1
const TOP_UP_MAX_UNITS = 5_000_000n; // $5

async function planBridge(intent: BridgeIntent, ctx: PlannerContext): Promise<PlanOutcome> {
  const from: ChainId = intent.fromChainId ?? DEFAULT_CHAIN;
  const to = intent.toChainId;
  const source = getChain(from);
  const destination = getChain(to);

  if (from === to) {
    return fail('no_bridge_route', `That money is already on ${source.name}.`);
  }

  if (source.testnet !== destination.testnet) {
    return fail('no_bridge_route', `Blocky can't move money to ${destination.name} from here.`);
  }

  /* --- What leaves, and what arrives ------------------------------------- */

  const [token, self] = await Promise.all([
    ctx.resolveToken(intent.token, from),
    ctx.resolveRecipient({ kind: 'self' }),
  ]);

  if (!token) {
    return fail('unknown_token', describeUnknownToken(intent.token));
  }

  if (!self) {
    return fail('unknown_recipient', "Your wallet isn't ready yet. Try again in a moment.");
  }

  // What can leave: USDC, or the source chain's own gas token (ETH on
  // Arbitrum, say — how money that was swapped out comes home).
  const sendsNative = token.address === NATIVE_TOKEN && !source.gasPaidInUsdc;
  if (token.address !== source.usdc && !sendsNative) {
    return fail(
      'not_implemented',
      `From ${source.name} Blocky can move USDC or ${source.nativeCurrency.symbol} right now, not ${token.symbol}.`,
    );
  }

  const received = receivedToken(intent, to);

  // Selling a gas token lands as USDC; swapping one gas token for another
  // isn't a route anyone offers yet.
  if (!received || (sendsNative && received.kind !== 'usdc')) {
    return fail(
      'not_implemented',
      sendsNative
        ? `${source.nativeCurrency.symbol} on ${source.name} can come back as USDC on ${destination.name} right now.`
        : `On ${destination.name} Blocky can deliver USDC or ${destination.nativeCurrency.symbol} right now.`,
    );
  }

  const cctp = !sendsNative && received.kind === 'usdc' && canMoveUsdcBetween(from, to) ? cctpContracts(from) : null;
  const acrossPool = acrossSpokePool(from);
  const periphery = sendsNative ? acrossPeriphery(from) : null;
  const swapHandler = received.kind === 'native' ? acrossSwapHandler(to) : null;
  const gasZip = !sendsNative && gasZipDepositContract(from) !== null && gasZipShortId(to) !== null;

  const anyRoute = sendsNative
    ? Boolean(periphery)
    : received.kind === 'usdc'
      ? Boolean(cctp || acrossPool)
      : Boolean((acrossPool && swapHandler) || gasZip);
  if (!anyRoute) {
    return fail('no_bridge_route', `Blocky can't move money from ${source.name} to ${destination.name} yet.`);
  }

  // Always the user's own address: moving money between chains is moving it
  // to yourself. Paying someone else on another chain is a different intent.
  const wallet = self.address;
  const gasToken = nativeTokenOn(to);
  // Top-ups are bought with Arc USDC through Gas.zip, so only from Arc.
  const wantsGas = received.kind === 'usdc' && intent.includeGas === true && source.gasPaidInUsdc;

  /* --- Read everything at once ------------------------------------------- */

  // Calls, for sizing gas: approve + deposit, plus a top-up when there is one.
  // Selling a gas token is one call, but it swaps on a DEX before it bridges:
  // measured at ~475k gas on Arbitrum, so it is sized as five ordinary calls
  // (~540k) — "all of it" must leave enough behind to pay for itself.
  const callCount = (sendsNative ? SWAP_AND_BRIDGE_CALLS : 2) + (wantsGas ? 1 : 0);

  const [
    balance,
    usdcBalanceUsd,
    networkFeeUsd,
    sourceGasUsd,
    destinationGasUsd,
    destinationFeeUsd,
    unitPrice,
    gasTokenPrice,
  ] = await Promise.all([
    ctx.balanceOf(token),
    ctx.usdcBalanceUsd(from),
    ctx.estimateNetworkFeeUsd(from, probeCalls(from, token, callCount)),
    // Off Arc, gas is the chain's own token — the one being sold, or ETH
    // alongside the USDC.
    source.gasPaidInUsdc ? null : ctx.nativeBalanceUsd(from).catch(() => null),
    ctx.nativeBalanceUsd(to).catch(() => null),
    ctx.estimateNetworkFeeUsd(to, []).catch(() => null),
    sendsNative ? ctx.priceOf(token).catch(() => null) : '1',
    ctx.priceOf(gasToken).catch(() => null),
  ]);

  const gas = selectGasStrategy({ chainId: from, networkFeeUsd, usdcBalanceUsd, nativeBalanceUsd: sourceGasUsd });
  if (!gas.ok) {
    return fail('no_gas_route', gas.message);
  }

  // Whether the user can already pay for a transaction there, before anything
  // lands. On Arc, the USDC that lands pays its own gas.
  const hasGasThere =
    destination.gasPaidInUsdc ||
    (destinationFeeUsd !== null &&
      canPayForGeneralAction({ chainId: to, networkFeeUsd: destinationFeeUsd, usdcBalanceUsd: '0', nativeBalanceUsd: destinationGasUsd }));

  /* --- How much leaves ---------------------------------------------------- */

  // A top-up only when asked for and actually needed — never a surprise
  // purchase on top of what the user said.
  const topUp =
    wantsGas && !hasGasThere
      ? clamp(parseUsd(destinationFeeUsd ?? '0') * TOP_UP_TRANSACTIONS, TOP_UP_MIN_UNITS, TOP_UP_MAX_UNITS)
      : 0n;

  // The gas stays behind when it comes out of the token being sent: Arc USDC
  // on Arc, or the gas token itself when that is what's being sold. Moving
  // USDC off another chain pays its gas in ETH, which the USDC doesn't cover.
  if (sendsNative && unitPrice === null) {
    return fail('unpriced_amount', `I don't have a reliable price for ${token.symbol} right now. Try again in a minute.`);
  }
  const gasReserve =
    source.gasPaidInUsdc || sendsNative ? feeInTokenUnits(gas.plan.totalUsd, token, unitPrice ?? '1') : 0n;
  const amount = resolveAmount({ spec: intent.amount, token, unitPrice, balance, reserve: gasReserve + topUp });

  if (!amount.ok) {
    return fail(...amountFailure(amount.reason, token));
  }

  const input = amount.amount;
  const displayAmount = formatUnits(input, token.decimals);

  /* --- Price every route, keep the best ---------------------------------- */

  const routes = sendsNative
    ? await nativeSourceRoutes({ ctx, from, to, input, wallet, description: `Swap ${displayAmount} ${token.symbol} on ${source.name} into USDC on ${destination.name}` })
    : received.kind === 'usdc'
      ? await usdcRoutes({ ctx, from, to, token, input, wallet, cctp, acrossPool, displayAmount })
      : await nativeRoutes({ ctx, from, to, token, input, wallet, gasToken, displayAmount, useAcross: Boolean(acrossPool && swapHandler), useGasZip: gasZip });

  const route = bestRoute(routes);

  if (!route) {
    const inputUsd = assetDelta(token, input, unitPrice).usdValue;
    return fail(
      'no_bridge_route',
      inputUsd !== null && parseUsd(inputUsd) < 1_000_000n
        ? `That's too little to move to ${destination.name} — the fees would take all of it.`
        : `Moving money from ${source.name} to ${destination.name} isn't available right now. Try again in a minute.`,
    );
  }

  /* --- The gas top-up, if there is one ----------------------------------- */

  const topUpQuote = topUp > 0n ? await ctx.gasZipQuote(from, to, topUp, wallet).catch(() => null) : null;
  const topUpCall = topUpQuote
    ? gasZipDepositCall({
        chainId: from,
        contract: topUpQuote.contract,
        data: encodeGasZipDeposit(topUpQuote.shortId, wallet),
        value: topUpQuote.value,
        description: `Get ${displayUsd(formatUsd(topUp))} of ${gasToken.symbol} on ${destination.name} for gas`,
      })
    : null;

  /* --- Build the plan ----------------------------------------------------- */

  const receivedAs = received.kind === 'usdc' ? usdcOn(to, token) : gasToken;
  const receivedPrice = received.kind === 'usdc' ? '1' : gasTokenPrice;

  const moved = assetDelta(token, input, unitPrice);
  const landed = assetDelta(receivedAs, route.arrive, receivedPrice);
  const toppedUp = topUpQuote ? assetDelta(gasToken, topUpQuote.expectedOut, gasTokenPrice) : null;

  // What the route keeps: what left, less what landed, valued in dollars.
  // Unpriced means unknown, and is counted as nothing rather than guessed.
  const routeCost = lossUnits(moved.usdValue, landed.usdValue);
  const topUpCost = topUpQuote ? lossUnits(formatUsd(topUp), toppedUp?.usdValue ?? null) : 0n;

  const fee: Fee = {
    totalUsd: formatUsd(parseUsd(gas.plan.totalUsd) + routeCost + topUpCost),
    paidIn: gas.plan.mode,
    breakdown: { networkUsd: gas.plan.networkUsd, paymasterUsd: '0', serviceUsd: formatUsd(routeCost + topUpCost) },
  };

  const canActThere = hasGasThere || received.kind === 'native' || topUpQuote !== null;

  const warnings: Warning[] = [
    ...feeWarnings(fee.totalUsd, moved.usdValue),
    ...destinationWarnings({ chainName: destination.name, gasToken: gasToken.symbol, canActThere }),
  ];

  const fromElsewhere = source.id !== DEFAULT_CHAIN ? source.name : null;

  return {
    ok: true,
    plan: stamp({
      intentType: 'bridge',
      summary:
        received.kind === 'usdc' && !sendsNative
          ? summariseMove(moved, landed, destination.name, route, topUpQuote ? topUp : null, gasToken.symbol, fromElsewhere)
          : summariseSwap(moved, landed, destination.name, route, fromElsewhere),
      modelRationale: intent.rationale,
      outflow: topUpQuote ? [moved, assetDelta(token, topUp, '1')] : [moved],
      inflow: toppedUp ? [landed, toppedUp] : [landed],
      // Your own wallet, on another chain: there is no third party to vet.
      recipient: null,
      fee,
      warnings,
      calls: topUpCall ? [...route.calls, topUpCall] : route.calls,
      route: {
        provider: route.provider,
        etaSeconds: route.etaSeconds,
        feeIsCeiling: route.feeIsCeiling,
        ...(route.minimum !== undefined ? { minimumReceived: route.minimum.toString() } : {}),
        ...(topUpQuote ? { gasTopUp: { provider: 'gas.zip' } } : {}),
      },
    }),
  };
}

/** A chain's USDC, as a resolved token — named like the token it came from. */
function usdcOn(chainId: ChainId, like: ResolvedToken): ResolvedToken {
  const chain = getChain(chainId);
  return {
    ...like,
    chainId,
    address: chain.usdc,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    verified: true,
  };
}

/** Selling the source chain's gas token for USDC elsewhere: Across, through its Periphery. */
async function nativeSourceRoutes(args: {
  ctx: PlannerContext;
  from: ChainId;
  to: ChainId;
  input: bigint;
  wallet: Address;
  description: string;
}): Promise<Route[]> {
  const quote = await args.ctx.acrossNativeSwapQuote(args.from, args.to, args.input, args.wallet).catch(() => null);
  if (!quote || quote.inputAmount !== args.input) return [];

  return [
    {
      provider: 'across-swap',
      arrive: quote.expectedOut,
      minimum: quote.minOut,
      etaSeconds: quote.etaSeconds,
      feeIsCeiling: false,
      calls: [
        {
          chainId: args.from,
          to: quote.periphery,
          data: quote.data,
          value: quote.inputAmount.toString(),
          description: args.description,
        },
      ],
    },
  ];
}

/** Moving USDC as USDC: Circle's CCTP and Across, both priced. */
async function usdcRoutes(args: {
  ctx: PlannerContext;
  from: ChainId;
  to: ChainId;
  token: ResolvedToken;
  input: bigint;
  wallet: Address;
  cctp: ReturnType<typeof cctpContracts>;
  acrossPool: Address | null;
  displayAmount: string;
}): Promise<Route[]> {
  const { ctx, from, to, token, input, wallet, cctp, acrossPool, displayAmount } = args;
  const destination = getChain(to);

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

  return routes;
}

/**
 * USDC in, the destination's gas token out: Gas.zip (cheapest, for amounts it
 * has room for) and an Across swap (any size), both priced in the same token.
 */
async function nativeRoutes(args: {
  ctx: PlannerContext;
  from: ChainId;
  to: ChainId;
  token: ResolvedToken;
  input: bigint;
  wallet: Address;
  gasToken: ResolvedToken;
  displayAmount: string;
  useAcross: boolean;
  useGasZip: boolean;
}): Promise<Route[]> {
  const { ctx, from, to, token, input, wallet, gasToken, displayAmount, useAcross, useGasZip } = args;
  const destination = getChain(to);
  const description = `Swap ${displayAmount} ${token.symbol} into ${gasToken.symbol} on ${destination.name}`;

  const [gasZipQuote, swapQuote] = await Promise.all([
    useGasZip ? ctx.gasZipQuote(from, to, input, wallet).catch(() => null) : null,
    useAcross ? ctx.acrossSwapQuote(from, to, input, gasToken.address, wallet).catch(() => null) : null,
  ]);

  const routes: Route[] = [];

  if (gasZipQuote && gasZipQuote.inputAmount === input) {
    routes.push({
      provider: 'gas.zip',
      arrive: gasZipQuote.expectedOut,
      etaSeconds: gasZipQuote.etaSeconds,
      feeIsCeiling: false,
      calls: [
        gasZipDepositCall({
          chainId: from,
          contract: gasZipQuote.contract,
          data: encodeGasZipDeposit(gasZipQuote.shortId, wallet),
          value: gasZipQuote.value,
          description,
        }),
      ],
    });
  }

  if (swapQuote && swapQuote.inputAmount === input) {
    routes.push({
      provider: 'across-swap',
      arrive: swapQuote.expectedOut,
      minimum: swapQuote.minOut,
      etaSeconds: swapQuote.etaSeconds,
      feeIsCeiling: false,
      calls: acrossSwapCalls({
        chainId: from,
        token,
        spokePool: swapQuote.spokePool,
        inputAmount: input,
        depositData: swapQuote.depositData,
        displayAmount,
        description,
      }),
    });
  }

  return routes;
}

/** What the user asked to receive: USDC (the default), or the destination's gas token. Null for anything else. */
function receivedToken(intent: BridgeIntent, to: ChainId): { kind: 'usdc' } | { kind: 'native' } | null {
  const ref = intent.receive;
  if (!ref) return { kind: 'usdc' };

  const destination = getChain(to);

  if (ref.kind === 'symbol') {
    const symbol = ref.symbol.trim().toUpperCase();
    if (symbol === 'USDC') return { kind: 'usdc' };
    if (symbol === destination.nativeCurrency.symbol.toUpperCase()) return { kind: 'native' };
    return null;
  }

  if (ref.chainId !== to) return null;
  if (ref.address === destination.usdc) return { kind: 'usdc' };
  if (ref.address === NATIVE_TOKEN) return { kind: 'native' };
  return null;
}

/** A chain's native gas token, as a resolved token named by the zero address. */
function nativeTokenOn(chainId: ChainId): ResolvedToken {
  const { nativeCurrency } = getChain(chainId);
  return {
    chainId,
    address: NATIVE_TOKEN,
    symbol: nativeCurrency.symbol,
    name: nativeCurrency.symbol,
    decimals: nativeCurrency.decimals,
    logoUrl: null,
    verified: true,
  };
}

/** Dollars in, less dollars out, as USD base units; never negative, and nothing when either side is unpriced. */
function lossUnits(inputUsd: string | null, landedUsd: string | null): bigint {
  if (inputUsd === null || landedUsd === null) return 0n;
  const loss = parseUsd(inputUsd) - parseUsd(landedUsd);
  return loss > 0n ? loss : 0n;
}

function clamp(value: bigint, min: bigint, max: bigint): bigint {
  return value < min ? min : value > max ? max : value;
}

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

/** Stand-in calls, for sizing gas before the amounts are known. */
function probeCalls(chainId: ChainId, token: ResolvedToken, count: number): PreparedCall[] {
  return Array.from({ length: count }, () => ({ chainId, to: token.address, data: '0x', value: '0', description: 'Gas estimate' }));
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
 * arrives too. A gas top-up is named, so it is never a surprise.
 */
function summariseMove(
  moved: AssetDelta,
  landed: AssetDelta,
  destinationName: string,
  route: Route,
  topUp: bigint | null,
  gasSymbol: string,
  sourceName: string | null,
): string {
  const from = sourceName ? ` from ${sourceName}` : '';
  const plus = topUp ? `, plus ${displayUsd(formatUsd(topUp))} of ${gasSymbol} for gas` : '';
  const arrives = `${route.feeIsCeiling ? 'At least ' : ''}${displayUsd(landed.usdValue ?? '0')} arrives`;
  return `Move ${displayUsd(moved.usdValue ?? '0')}${from} to your wallet on ${destinationName}${plus}. ${arrives} in ${describeEta(route.etaSeconds)}.`;
}

/**
 * "Swap $20.00 into ETH on Arbitrum. About 0.00743 ETH ($19.99) arrives in
 * about 2 seconds." Coming home: "Swap 0.005 ETH ($13.47) on Arbitrum One into
 * USDC on Arc. About $13.46 arrives in about a second."
 */
function summariseSwap(
  moved: AssetDelta,
  landed: AssetDelta,
  destinationName: string,
  route: Route,
  sourceName: string | null,
): string {
  const when = `in ${describeEta(route.etaSeconds)}`;

  if (sourceName) {
    const worth = moved.usdValue === null ? '' : ` (${displayUsd(moved.usdValue)})`;
    const arrives = landed.usdValue === null ? `${shortAmount(landed.displayAmount)} ${landed.token.symbol}` : displayUsd(landed.usdValue);
    return `Swap ${shortAmount(moved.displayAmount)} ${moved.token.symbol}${worth} on ${sourceName} into ${landed.token.symbol} on ${destinationName}. About ${arrives} arrives ${when}.`;
  }

  const worth = landed.usdValue === null ? '' : ` (${displayUsd(landed.usdValue)})`;
  return `Swap ${displayUsd(moved.usdValue ?? '0')} into ${landed.token.symbol} on ${destinationName}. About ${shortAmount(landed.displayAmount)} ${landed.token.symbol}${worth} arrives ${when}.`;
}

/** A token amount trimmed for reading: six significant digits at most. */
function shortAmount(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  if (whole !== '0') return fraction ? `${whole}.${fraction.slice(0, Math.max(0, 6 - whole.length))}`.replace(/\.?0+$/, '') : whole;
  const firstSignificant = fraction.search(/[1-9]/);
  if (firstSignificant === -1) return '0';
  return `0.${fraction.slice(0, firstSignificant + 4)}`.replace(/0+$/, '');
}

function describeEta(seconds: number): string {
  if (seconds < 1.5) return 'about a second';
  if (seconds < 60) return `about ${Math.round(seconds)} seconds`;
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
