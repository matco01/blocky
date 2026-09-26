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
  STOCK_CHAIN,
  type Stock,
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
  stockByAddress,
  stockBySymbol,
} from '@blocky/wallet-core';
import { assetDelta, resolveAmount } from './amount';
import {
  acrossDepositCalls,
  acrossSwapCalls,
  cctpBurnCalls,
  encodeErc20Approve,
  encodeErc20Transfer,
  erc20TransferCall,
  gasZipDepositCall,
} from './calls';
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

/* -------------------------------------------------------------------------- */
/*  Transfer                                                                   */
/* -------------------------------------------------------------------------- */

async function planTransfer(intent: TransferIntent, ctx: PlannerContext): Promise<PlanOutcome> {
  // A send goes out from wherever the money is: Arc by default, or the chain
  // the user's balance sits on — the recipient receives it there.
  const chainId: ChainId = intent.chainId ?? DEFAULT_CHAIN;
  const chain = getChain(chainId);

  if (chain.testnet !== getChain(DEFAULT_CHAIN).testnet) {
    return fail('not_implemented', `Blocky can't send on ${chain.name} from here.`);
  }

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

  // The chain's own gas token (ETH on Arbitrum) goes as a plain value transfer;
  // everything else — USDC, a stock — as an ERC-20 transfer.
  const sendsNative = token.address === NATIVE_TOKEN && !chain.gasPaidInUsdc;

  /* --- Work out how much ------------------------------------------------- */

  /*
   * The fee is estimated against a placeholder call, because the exact amount
   * does not change the gas cost of a transfer — the calldata is the same
   * length either way. That lets it run alongside the balance reads rather
   * than after them.
   */
  const transferCall = (amount: bigint, displayAmount: string): PreparedCall =>
    sendsNative
      ? {
          chainId,
          to: recipient.address,
          data: '0x',
          value: amount.toString(),
          description: `Send ${displayAmount} ${token.symbol} to ${recipient.display}`,
        }
      : erc20TransferCall({ chainId, token, to: recipient.address, amount, displayAmount, recipientDisplay: recipient.display });

  const [unitPrice, balance, usdcBalanceUsd, nativeBalanceUsd, networkFeeUsd, flagged] = await Promise.all([
    ctx.priceOf(token),
    ctx.balanceOf(token),
    // Asked for independently of the token being sent: on Arc, gas is taken
    // in USDC whatever is moving; anywhere else, in the chain's own token.
    ctx.usdcBalanceUsd(chainId),
    chain.gasPaidInUsdc ? null : ctx.nativeBalanceUsd(chainId).catch(() => null),
    ctx.estimateNetworkFeeUsd(chainId, [transferCall(0n, '0')]),
    ctx.isAddressFlagged(recipient.address),
  ]);

  const isUsdc = token.address === chain.usdc;

  const gas = selectGasStrategy({ chainId, networkFeeUsd, usdcBalanceUsd, nativeBalanceUsd });

  if (!gas.ok) {
    return fail('no_gas_route', gas.message);
  }

  if (sendsNative && unitPrice === null) {
    return fail('unpriced_amount', `I don't have a reliable price for ${token.symbol} right now. Try again in a minute.`);
  }

  /*
   * When the fee comes out of the token being sent, it has to fit alongside the
   * amount — for every kind of amount, not only "max". On Arc that is every USDC
   * send; elsewhere, sending the gas token itself — with headroom for the most
   * the fee could be, which is what a node checks the balance against.
   * Without this, "send my last $10" passes planning and then fails on-chain.
   */
  const reserve =
    gas.plan.mode === 'usdc' && isUsdc && unitPrice !== null
      ? feeInTokenUnits(gas.plan.totalUsd, token, unitPrice)
      : sendsNative
        ? feeInTokenUnits(gas.plan.totalUsd, token, unitPrice!) * NATIVE_GAS_HEADROOM
        : 0n;

  const amount = resolveAmount({ spec: intent.amount, token, unitPrice, balance, reserve });

  if (!amount.ok) {
    if (amount.reason === 'insufficient' && chainId !== DEFAULT_CHAIN) {
      return fail('insufficient_balance', `You don't have that much ${token.symbol} on ${chain.name}.`);
    }
    return fail(...amountFailure(amount.reason, token));
  }

  /* --- Build the transaction --------------------------------------------- */

  const delta = assetDelta(token, amount.amount, unitPrice);
  const calls: PreparedCall[] = [transferCall(amount.amount, delta.displayAmount)];

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
      summary: summariseTransfer(delta, recipient, fee, chainId === DEFAULT_CHAIN ? null : chain.name),
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

/** How many gas estimates stay behind when the gas token itself is being sold. */
const NATIVE_GAS_HEADROOM = 3n;

/**
 * Price impact, in basis points of what is swapped. Above the first the user
 * is warned and must confirm; above the second it is not offered at all — at
 * that point a smaller size is the only honest suggestion.
 */
const WARN_IMPACT_BPS = 200n; // 2%
const MAX_IMPACT_BPS = 1_000n; // 10%

/** The small trade a big one is measured against: $1,000, where fees are a rounding error and the market barely moves. */
const IMPACT_REFERENCE_UNITS = 1_000_000_000n;

/** Gas for a swap-and-bridge, in ordinary calls' worth — see where it's used. */
const SWAP_AND_BRIDGE_CALLS = 5;

/** CCTP Fast Transfers with forwarding land in well under a minute. */
const CCTP_ETA_SECONDS = 30;

/**
 * A gas top-up is sized to what the chain really costs, not a round number —
 * on a small portfolio, a dollar of gas nobody needed is noticed. It covers
 * this many of the heaviest thing the user will do there (selling or moving
 * back is a swap-and-bridge), each with the max-fee headroom a wallet must
 * hold, within these bounds (USD, 6 decimals). On Robinhood Chain that is
 * about a quarter; on Ethereum it can reach the cap.
 */
const TOP_UP_SALES = 2n;
const TOP_UP_MIN_UNITS = 100_000n; // $0.10
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
  // A stock, sold back for USDC. Only a listed one: the same pinned address a buy pays into.
  const soldStock = source.gasPaidInUsdc ? null : stockByAddress(from, token.address);
  // Selling something that isn't USDC, for USDC somewhere else.
  const sells = sendsNative || soldStock !== null;
  if (token.address !== source.usdc && !sells) {
    return fail(
      'not_implemented',
      `From ${source.name} Blocky can move ${source.usdc ? 'USDC, ' : ''}${source.nativeCurrency.symbol}${from === STOCK_CHAIN ? ' or your stocks' : ''} right now, not ${token.symbol}.`,
    );
  }

  const received = await receivedToken(intent, to, ctx);

  if (received?.kind === 'stock_elsewhere') {
    return fail(
      'no_bridge_route',
      `${received.stock.name} is a stock: stocks are bought on ${getChain(STOCK_CHAIN).name} (chain ${STOCK_CHAIN}), and held there.`,
    );
  }
  if (received?.kind === 'usdc' && !destination.usdc) {
    return fail(
      'no_bridge_route',
      `There's no USDC on ${destination.name}. Blocky can buy stocks there — Apple, Nvidia, the S&P 500 and more.`,
    );
  }

  // Selling lands as USDC; swapping one non-dollar thing straight into
  // another isn't a route anyone offers yet.
  if (!received || (sells && received.kind !== 'usdc')) {
    return fail(
      'not_implemented',
      sells
        ? `${soldStock ? soldStock.name : source.nativeCurrency.symbol} on ${source.name} can come back as USDC on ${destination.name} right now.`
        : `On ${destination.name} Blocky can deliver USDC or ${destination.nativeCurrency.symbol} right now.`,
    );
  }

  const cctp = !sells && received.kind === 'usdc' && canMoveUsdcBetween(from, to) ? cctpContracts(from) : null;
  const acrossPool = acrossSpokePool(from);
  const periphery = sells ? acrossPeriphery(from) : null;
  const swapHandler = received.kind !== 'usdc' ? acrossSwapHandler(to) : null;
  const gasZip = !sells && received.kind === 'native' && gasZipDepositContract(from) !== null && gasZipShortId(to) !== null;

  const anyRoute = sells
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
  // Blocky thinks about gas for the user: whatever lands off Arc — USDC or a
  // stock — can't be moved or sold again without a little of that chain's gas
  // token, so some comes along unless they said not to (and only if they have
  // none there — see `topUp`). Bought with Arc USDC through Gas.zip, so only from Arc.
  const wantsGas =
    received.kind !== 'native' && intent.includeGas !== false && source.gasPaidInUsdc && !destination.gasPaidInUsdc;
  // Blocky's fee: on everything that starts on Arc — moves and swaps. Coming
  // home is free, and so are plain sends. From Arc it rides in the same
  // all-or-nothing batch as the move, so a move that fails takes no fee.
  const feeTerms = source.id === DEFAULT_CHAIN ? (ctx.blockyFee?.() ?? null) : null;

  /* --- Read everything at once ------------------------------------------- */

  // Calls, for sizing gas: approve + deposit, plus a top-up when there is one.
  // Selling a gas token is one call, but it swaps on a DEX before it bridges:
  // measured at ~475k gas on Arbitrum, so it is sized as five ordinary calls
  // (~540k) — "all of it" must leave enough behind to pay for itself.
  const callCount = (sells ? SWAP_AND_BRIDGE_CALLS + (soldStock ? 1 : 0) : 2) + (wantsGas ? 1 : 0) + (feeTerms ? 1 : 0);

  const [
    balance,
    usdcBalanceUsd,
    networkFeeUsd,
    sourceGasUsd,
    destinationGasUsd,
    destinationFeeUsd,
    unitPrice,
    gasTokenPrice,
    receivedTokenPrice,
  ] = await Promise.all([
    ctx.balanceOf(token),
    ctx.usdcBalanceUsd(from),
    ctx.estimateNetworkFeeUsd(from, probeCalls(from, token, callCount)),
    // Off Arc, gas is the chain's own token — the one being sold, or ETH
    // alongside the USDC.
    source.gasPaidInUsdc ? null : ctx.nativeBalanceUsd(from).catch(() => null),
    ctx.nativeBalanceUsd(to).catch(() => null),
    // What leaving there costs: a sale or a move back is a swap-and-bridge.
    ctx.estimateNetworkFeeUsd(to, probeCalls(to, gasToken, SWAP_AND_BRIDGE_CALLS)).catch(() => null),
    sells ? ctx.priceOf(token).catch(() => null) : '1',
    ctx.priceOf(gasToken).catch(() => null),
    received.kind === 'stock' ? ctx.priceOf(received.token).catch(() => null) : null,
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
  const topUpSize =
    wantsGas && !hasGasThere
      ? clamp(parseUsd(destinationFeeUsd ?? '0') * NATIVE_GAS_HEADROOM * TOP_UP_SALES, TOP_UP_MIN_UNITS, TOP_UP_MAX_UNITS)
      : 0n;
  // Quoted before the amount is settled: "all of it" must hold back only for
  // a top-up that can actually be bought, never for one that can't.
  const topUpQuote = topUpSize > 0n ? await ctx.gasZipQuote(from, to, topUpSize, wallet).catch(() => null) : null;
  const topUp = topUpQuote ? topUpSize : 0n;

  // The gas stays behind when it comes out of the token being sent: Arc USDC
  // on Arc, or the gas token itself when that is what's being sold. Moving
  // USDC off another chain pays its gas in ETH, which the USDC doesn't cover.
  if (sells && unitPrice === null) {
    return fail('unpriced_amount', `I don't have a reliable price for ${token.symbol} right now. Try again in a minute.`);
  }
  const gasReserve = source.gasPaidInUsdc
    ? feeInTokenUnits(gas.plan.totalUsd, token, '1')
    : sendsNative
      ? // A wallet must afford its *maximum* fee, not today's: the node refuses
        // a transaction unless balance covers value + gas limit × max fee per
        // gas, and reports it as a bare revert. Measured on Arbitrum: a 2× max
        // fee failed with the estimate held back. So three estimates stay
        // behind — pennies, and still the user's.
        feeInTokenUnits(gas.plan.totalUsd, token, unitPrice ?? '1') * NATIVE_GAS_HEADROOM
      : 0n;
  const amount = resolveAmount({ spec: intent.amount, token, unitPrice, balance, reserve: gasReserve + topUp });

  if (!amount.ok) {
    if (amount.reason !== 'insufficient') return fail(...amountFailure(amount.reason, token));

    // Name the chain, and say what *is* there: money swapped out to another
    // chain is usually its gas token, not USDC, and "not that much USDC" alone
    // reads as if it vanished.
    const where = source.id === DEFAULT_CHAIN ? '' : ` on ${source.name}`;
    const otherToken = !sendsNative && !source.gasPaidInUsdc && sourceGasUsd !== null && parseUsd(sourceGasUsd) > 0n;
    return fail(
      'insufficient_balance',
      balance === 0n
        ? `You don't have any ${token.symbol}${where}.${otherToken ? ` You do have ${source.nativeCurrency.symbol} there (${displayUsd(sourceGasUsd!)}) — that can come home as USDC too.` : ''}`
        : `You don't have that much ${token.symbol}${where}.`,
    );
  }

  const input = amount.amount;
  // Taken out of what leaves, never added on top: "move $100" still means $100 leaves.
  const blockyFee = feeTerms ? (input * BigInt(feeTerms.bps)) / 10_000n : 0n;
  const bridged = input - blockyFee;
  const displayAmount = formatUnits(bridged, token.decimals);

  /* --- Price every route, keep the best ---------------------------------- */

  const routes = sells
    ? await sellRoutes({
        ctx,
        from,
        to,
        token,
        input,
        wallet,
        description: `${soldStock ? `Sell ${shortAmount(displayAmount)} ${soldStock.name}` : `Swap ${displayAmount} ${token.symbol}`} on ${source.name} into USDC on ${destination.name}`,
      })
    : received.kind === 'usdc'
      ? await usdcRoutes({ ctx, from, to, token, input: bridged, wallet, cctp, acrossPool, displayAmount })
      : await swapRoutes({
          ctx,
          from,
          to,
          token,
          input: bridged,
          wallet,
          output: received.kind === 'stock' ? received.token : gasToken,
          displayAmount,
          useAcross: Boolean(acrossPool && swapHandler),
          useGasZip: gasZip,
        });

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

  const topUpCall = topUpQuote
    ? gasZipDepositCall({
        chainId: from,
        contract: topUpQuote.contract,
        data: encodeGasZipDeposit(topUpQuote.shortId, wallet),
        value: topUpQuote.value,
        description: `Get ${displayUsd(formatUsd(topUp))} of ${gasToken.symbol} on ${destination.name} for gas`,
      })
    : null;

  /* --- Blocky's fee -------------------------------------------------------- */

  // After the move, so on Arc it batches with it; a move that has to go alone
  // (a Gas.zip deposit carries value) is sent first, and the fee only after it lands.
  const feeCall: PreparedCall | null =
    feeTerms && blockyFee > 0n
      ? {
          chainId: from,
          to: token.address,
          data: encodeErc20Transfer(feeTerms.recipient, blockyFee),
          value: '0',
          description: `Blocky fee (${feeTerms.bps / 100}%)`,
        }
      : null;
  const blockyFeeUsd = feeCall ? (assetDelta(token, blockyFee, unitPrice).usdValue ?? '0') : '0';

  /* --- Build the plan ----------------------------------------------------- */

  const receivedAs = received.kind === 'usdc' ? usdcOn(to, token) : received.kind === 'stock' ? received.token : gasToken;
  const receivedPrice = received.kind === 'usdc' ? '1' : received.kind === 'stock' ? receivedTokenPrice : gasTokenPrice;

  const moved = assetDelta(token, input, unitPrice);
  const landed = assetDelta(receivedAs, route.arrive, receivedPrice);
  const toppedUp = topUpQuote ? assetDelta(gasToken, topUpQuote.expectedOut, gasTokenPrice) : null;

  // What the route keeps: what it was given, less what landed, valued in
  // dollars. Unpriced means unknown, and is counted as nothing rather than guessed.
  const bridgedUsd = assetDelta(token, bridged, unitPrice).usdValue;
  const routeCost = lossUnits(bridgedUsd, landed.usdValue);

  /*
   * Slippage, thought through for the user. On a thin market the price a swap
   * gets worsens with size: $100 of a stock costs cents, $100,000 of it can
   * cost thousands. Past a point it is refused with the number, so the agent
   * can offer a smaller size; before that, the user is told plainly and has
   * to confirm. Measured against a small trade of the same thing at the same
   * moment — see `sizeImpactBps` — not against a price feed.
   */
  const swapped = received.kind !== 'usdc' || sells;
  const impactBps =
    swapped && route.provider === 'across-swap' && bridgedUsd !== null
      ? await sizeImpactBps({
          ctx,
          from,
          to,
          wallet,
          sold: sells ? token : null,
          bought: receivedAs,
          input: sells ? input : bridged,
          inputUsd: parseUsd(bridgedUsd),
          arrive: route.arrive,
          oracleLossUnits: routeCost,
        })
      : 0n;
  if (impactBps > MAX_IMPACT_BPS) {
    return fail(
      'price_impact',
      `That size would lose about ${bpsAsPercent(impactBps)} to the price — there isn't enough trading in ${received.kind === 'stock' ? received.stock.name : (soldStock?.name ?? receivedAs.symbol)} for it right now. A smaller amount, or a few smaller trades, costs far less.`,
    );
  }
  const topUpCost = topUpQuote ? lossUnits(formatUsd(topUp), toppedUp?.usdValue ?? null) : 0n;

  const fee: Fee = {
    totalUsd: formatUsd(parseUsd(gas.plan.totalUsd) + routeCost + topUpCost + parseUsd(blockyFeeUsd)),
    paidIn: gas.plan.mode,
    breakdown: {
      networkUsd: gas.plan.networkUsd,
      paymasterUsd: '0',
      serviceUsd: formatUsd(routeCost + topUpCost),
      ...(feeCall ? { blockyUsd: blockyFeeUsd } : {}),
    },
  };

  const canActThere = hasGasThere || received.kind === 'native' || topUpQuote !== null;

  const impactWarning: Warning[] =
    impactBps > WARN_IMPACT_BPS
      ? [
          {
            code: 'high_price_impact',
            severity: 'danger',
            message: `About ${bpsAsPercent(impactBps)} of this goes to price impact — the market is thin at this size. Smaller amounts cost less.`,
          },
        ]
      : [];

  const warnings: Warning[] = [
    ...impactWarning,
    // Price impact already says it; the fee warning would say it again.
    ...(impactWarning.length ? [] : feeWarnings(fee.totalUsd, moved.usdValue)),
    ...destinationWarnings({ chainName: destination.name, gasToken: gasToken.symbol, canActThere }),
  ];

  const fromElsewhere = source.id !== DEFAULT_CHAIN ? source.name : null;

  return {
    ok: true,
    plan: stamp({
      intentType: 'bridge',
      summary:
        received.kind === 'stock'
          ? summariseBuy(moved, landed, received.stock.name, route, topUpQuote ? topUp : null, gasToken.symbol)
          : soldStock
            ? summariseSell(moved, landed, soldStock.name, destination.name, route)
            : received.kind === 'usdc' && !sells
              ? summariseMove(moved, landed, destination.name, route, topUpQuote ? topUp : null, gasToken.symbol, fromElsewhere)
              : summariseSwap(moved, landed, destination.name, route, fromElsewhere),
      modelRationale: intent.rationale,
      outflow: topUpQuote ? [moved, assetDelta(token, topUp, '1')] : [moved],
      inflow: toppedUp ? [landed, toppedUp] : [landed],
      // Your own wallet, on another chain: there is no third party to vet.
      recipient: null,
      fee,
      warnings,
      calls: [...route.calls, ...(feeCall ? [feeCall] : []), ...(topUpCall ? [topUpCall] : [])],
      route: {
        provider: route.provider,
        etaSeconds: route.etaSeconds,
        feeIsCeiling: route.feeIsCeiling,
        ...(route.minimum !== undefined ? { minimumReceived: route.minimum.toString() } : {}),
        ...(topUpQuote ? { gasTopUp: { provider: 'gas.zip' } } : {}),
      },
      ...(feeCall && feeTerms
        ? { blockyFee: { amount: blockyFee.toString(), usd: blockyFeeUsd, recipient: feeTerms.recipient, bps: feeTerms.bps } }
        : {}),
    }),
  };
}

/** A chain's USDC, as a resolved token — named like the token it came from. */
function usdcOn(chainId: ChainId, like: ResolvedToken): ResolvedToken {
  const chain = getChain(chainId);
  if (!chain.usdc) throw new Error(`${chain.name} has no USDC.`);
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

/**
 * Selling something on another chain for USDC elsewhere — its gas token, or a
 * stock: Across, through its Periphery. A gas token rides as value; a token is
 * approved to the Periphery for exactly the amount sold, then pulled.
 */
async function sellRoutes(args: {
  ctx: PlannerContext;
  from: ChainId;
  to: ChainId;
  token: ResolvedToken;
  input: bigint;
  wallet: Address;
  description: string;
}): Promise<Route[]> {
  const native = args.token.address === NATIVE_TOKEN;
  const quote = await args.ctx
    .acrossNativeSwapQuote(args.from, args.to, args.input, args.wallet, native ? undefined : args.token.address)
    .catch(() => null);
  if (!quote || quote.inputAmount !== args.input) return [];

  const sell: PreparedCall = {
    chainId: args.from,
    to: quote.periphery,
    data: quote.data,
    value: native ? quote.inputAmount.toString() : '0',
    description: args.description,
  };

  return [
    {
      provider: 'across-swap',
      arrive: quote.expectedOut,
      minimum: quote.minOut,
      etaSeconds: quote.etaSeconds,
      feeIsCeiling: false,
      calls: native
        ? [sell]
        : [
            {
              chainId: args.from,
              to: args.token.address,
              data: encodeErc20Approve(quote.periphery, args.input),
              value: '0',
              description: `Allow Across to take exactly this ${args.token.symbol}`,
            },
            sell,
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
 * USDC in, something else out on the destination — its gas token, or a stock:
 * Gas.zip (gas tokens only; cheapest for amounts it has room for) and an
 * Across swap (any size), both priced in the same token.
 */
async function swapRoutes(args: {
  ctx: PlannerContext;
  from: ChainId;
  to: ChainId;
  token: ResolvedToken;
  input: bigint;
  wallet: Address;
  output: ResolvedToken;
  displayAmount: string;
  useAcross: boolean;
  useGasZip: boolean;
}): Promise<Route[]> {
  const { ctx, from, to, token, input, wallet, output, displayAmount, useAcross, useGasZip } = args;
  const destination = getChain(to);
  const stock = stockByAddress(to, output.address);
  const description = stock
    ? `Buy ${stock.name} with ${displayAmount} ${token.symbol}`
    : `Swap ${displayAmount} ${token.symbol} into ${output.symbol} on ${destination.name}`;

  const [gasZipQuote, swapQuote] = await Promise.all([
    useGasZip ? ctx.gasZipQuote(from, to, input, wallet).catch(() => null) : null,
    useAcross ? ctx.acrossSwapQuote(from, to, input, output.address, wallet).catch(() => null) : null,
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

type Received =
  | { kind: 'usdc' }
  | { kind: 'native' }
  /** A listed stock, on the chain stocks live on. */
  | { kind: 'stock'; token: ResolvedToken; stock: Stock }
  /** A stock, asked for on some other chain — refused with where to find it. */
  | { kind: 'stock_elsewhere'; stock: Stock };

/**
 * What the user asked to receive: USDC (the default), the destination's gas
 * token, or a stock. Null for anything else. A stock counts only if it
 * resolves to one of the pinned stock tokens.
 */
async function receivedToken(intent: BridgeIntent, to: ChainId, ctx: PlannerContext): Promise<Received | null> {
  const ref = intent.receive;
  if (!ref) return { kind: 'usdc' };

  const destination = getChain(to);

  if (ref.kind === 'symbol') {
    const symbol = ref.symbol.trim().toUpperCase();
    if (symbol === 'USDC') return { kind: 'usdc' };
    if (symbol === destination.nativeCurrency.symbol.toUpperCase()) return { kind: 'native' };

    const listed = stockBySymbol(symbol);
    if (!listed) return null;
    if (listed.chainId !== to) return { kind: 'stock_elsewhere', stock: listed };
  } else {
    if (ref.chainId !== to) return null;
    if (ref.address === destination.usdc) return { kind: 'usdc' };
    if (ref.address === NATIVE_TOKEN) return { kind: 'native' };
  }

  const token = await ctx.resolveToken(ref, to);
  const stock = token ? stockByAddress(to, token.address) : null;
  return token && stock ? { kind: 'stock', token, stock } : null;
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
function summariseTransfer(outflow: AssetDelta, recipient: ResolvedRecipient, fee: Fee, chainName: string | null): string {
  const value = outflow.usdValue === null ? '' : ` (${displayUsd(outflow.usdValue)})`;
  const cost = parseUsd(fee.totalUsd) === 0n ? 'No fee' : `${displayUsd(fee.totalUsd)} fee`;
  // Off Arc, where it lands matters: the recipient receives it on that chain.
  const where = chainName ? ` on ${chainName}` : '';

  return `Send ${shortAmount(outflow.displayAmount)} ${outflow.token.symbol}${value} to ${recipient.display}${where}. ${cost}.`;
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

/**
 * "Buy $50.00 of Apple. About 0.1468 AAPL ($49.80) arrives in about 2
 * seconds." Said the way a person buys a stock: in dollars.
 */
function summariseBuy(
  moved: AssetDelta,
  landed: AssetDelta,
  name: string,
  route: Route,
  topUp: bigint | null,
  gasSymbol: string,
): string {
  const worth = landed.usdValue === null ? '' : ` (${displayUsd(landed.usdValue)})`;
  const plus = topUp ? `, plus ${displayUsd(formatUsd(topUp))} of ${gasSymbol} so you can sell later` : '';
  return `Buy ${displayUsd(moved.usdValue ?? '0')} of ${name}${plus}. About ${shortAmount(landed.displayAmount)} ${landed.token.symbol}${worth} arrives in ${describeEta(route.etaSeconds)}.`;
}

/** "Sell 0.05 Apple ($17.02) for USDC on Arc. About $17.00 arrives in about a second." */
function summariseSell(moved: AssetDelta, landed: AssetDelta, name: string, destinationName: string, route: Route): string {
  const worth = moved.usdValue === null ? '' : ` (${displayUsd(moved.usdValue)})`;
  return `Sell ${shortAmount(moved.displayAmount)} ${name}${worth} for USDC on ${destinationName}. About ${displayUsd(landed.usdValue ?? '0')} arrives in ${describeEta(route.etaSeconds)}.`;
}

/**
 * What a swap loses to its own size, in basis points: how much worse its rate
 * is than a {@link IMPACT_REFERENCE_UNITS} trade of the same thing, quoted at
 * the same moment on the same road. That isolates what size costs from
 * everything else — fixed fees, spreads, and above all a price feed that is
 * stale when the stock market is closed (on a weekend, a feed can put an
 * onchain stock several percent away from where it really trades).
 *
 * Trades under twice the reference size aren't measured: at that size the
 * market barely moves. If the reference can't be quoted, the loss against the
 * price feed stands in — imperfect, but a big trade is never waved through
 * unmeasured.
 */
async function sizeImpactBps(args: {
  ctx: PlannerContext;
  from: ChainId;
  to: ChainId;
  wallet: Address;
  /** What is sold when this is a sale; null when USDC buys `bought`. */
  sold: ResolvedToken | null;
  bought: ResolvedToken;
  input: bigint;
  inputUsd: bigint;
  arrive: bigint;
  oracleLossUnits: bigint;
}): Promise<bigint> {
  const { ctx, from, to, wallet, sold, bought, input, inputUsd, arrive } = args;
  if (inputUsd <= IMPACT_REFERENCE_UNITS * 2n || input === 0n) return 0n;

  const refInput = (input * IMPACT_REFERENCE_UNITS) / inputUsd;
  const reference = await (sold
    ? ctx.acrossNativeSwapQuote(from, to, refInput, wallet, sold.address === NATIVE_TOKEN ? undefined : sold.address)
    : ctx.acrossSwapQuote(from, to, refInput, bought.address, wallet)
  ).catch(() => null);

  if (!reference || reference.expectedOut <= 0n) {
    return inputUsd > 0n ? (args.oracleLossUnits * 10_000n) / inputUsd : 0n;
  }

  // 10000 × (1 − (arrive / input) ÷ (refOut / refInput)), never below zero.
  const ratio = (arrive * refInput * 10_000n) / (reference.expectedOut * input);
  return ratio >= 10_000n ? 0n : 10_000n - ratio;
}

/** 237 basis points as "2.4%". */
function bpsAsPercent(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(1).replace(/\.0$/, '')}%`;
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
