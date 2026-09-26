import { CHAIN, type Address, type ChainId, type Hex } from '@blocky/shared';
import { decodeAbiParameters, decodeFunctionData, parseAbi } from 'viem';
import { getChain } from './chains';
import type { Receipt } from './receipts';

/**
 * Moving USDC between chains through Across.
 *
 * Across is a relayer network: the user deposits on Arc, a relayer pays them
 * out on the destination from its own inventory within seconds, and is repaid
 * later from the deposit. The user pays one fee, taken out of the amount, and
 * needs nothing on the destination. If no relayer fills by the deadline, the
 * deposit is refunded to the user on Arc — the money is never stranded.
 *
 * Across's API supplies *prices*, never *contracts*: the SpokePool the user's
 * wallet calls is pinned here, and a quote naming any other address is
 * refused. The deposit calldata is built by our own planner from the quote's
 * numbers, never taken from the API.
 *
 * Verified against Arc mainnet: the SpokePool has code, a real deposit on Arc
 * decodes with the event below, and an approve + `depositV3` batch from a user
 * wallet simulates cleanly (~121k gas). Across does not serve Arc testnet.
 */

const API = 'https://app.across.to/api';

/**
 * The SpokePool on each origin chain we deposit from. Collected from Across's
 * own API and checked to have code on each chain; a quote naming any other
 * address is refused.
 */
const SPOKE_POOLS: Partial<Record<ChainId, Address>> = {
  [CHAIN.arc]: '0x9b4a302a548c7e313c2b74c461db7b84d3074a84',
  [CHAIN.ethereum]: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5',
  [CHAIN.optimism]: '0x6f26bf09b1c792e3228e5467807a900a503c0281',
  [CHAIN.unichain]: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
  [CHAIN.polygon]: '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096',
  [CHAIN.base]: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
  [CHAIN.arbitrum]: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a',
  [CHAIN.avalanche]: '0xfe9d541c92e4e90437c7152a00244886de37a658',
  [CHAIN.hyperevm]: '0x35e63ea3eb0fb7a3bc543c71fb66412e1f6b0e04',
  // From a live sell quote's swapAndBridge, and checked to have code.
  [CHAIN.robinhood]: '0xd29c85f15df544ba632c9e25829fd29d767d7978',
};

/**
 * Across's SpokePoolPeriphery — swaps on the origin chain, then deposits.
 * The same address on every chain it serves, checked to have code on each.
 */
const PERIPHERY: Address = '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4';

export function acrossPeriphery(chainId: ChainId): Address | null {
  return SPOKE_POOLS[chainId] && !getChain(chainId).gasPaidInUsdc ? PERIPHERY : null;
}

export function acrossSpokePool(chainId: ChainId): Address | null {
  return SPOKE_POOLS[chainId] ?? null;
}

export interface AcrossQuote {
  spokePool: Address;
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  /** Exactly what the relayer will pay out on the destination. */
  outputAmount: bigint;
  destinationChainId: ChainId;
  exclusiveRelayer: Address;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
  etaSeconds: number;
}

/**
 * Quote moving `inputAmount` of USDC from one chain to another. Null when
 * Across has no route, or the amount is below its minimum or above its limit —
 * "not this way", never an error. Throws only when the API itself fails.
 */
export async function fetchAcrossQuote(
  args: { from: ChainId; to: ChainId; inputAmount: bigint; recipient: Address },
  fetchImpl: typeof fetch = fetch,
): Promise<AcrossQuote | null> {
  const spokePool = acrossSpokePool(args.from);
  if (!spokePool || args.from === args.to) return null;

  const inputToken = getChain(args.from).usdc;
  const outputToken = getChain(args.to).usdc;
  if (!inputToken || !outputToken) return null;

  const params = new URLSearchParams({
    inputToken,
    outputToken,
    originChainId: String(args.from),
    destinationChainId: String(args.to),
    amount: args.inputAmount.toString(),
    recipient: args.recipient,
  });

  const response = await fetchImpl(`${API}/suggested-fees?${params}`);

  // Across answers an unsupported route or amount with a 4xx and a message:
  // that is "no route", not an outage.
  if (response.status >= 400 && response.status < 500) return null;
  if (!response.ok) throw new Error(`Across quote failed with ${response.status}`);

  const body = (await response.json()) as {
    spokePoolAddress?: string;
    outputAmount?: string;
    exclusiveRelayer?: string;
    timestamp?: string;
    fillDeadline?: string;
    exclusivityDeadline?: number | string;
    estimatedFillTimeSec?: number;
    isAmountTooLow?: boolean;
    limits?: { maxDeposit?: string };
  };

  if (body.isAmountTooLow) return null;
  if (body.limits?.maxDeposit && args.inputAmount > BigInt(body.limits.maxDeposit)) return null;

  // The contract the money goes to is ours to name, not the API's.
  if (body.spokePoolAddress?.toLowerCase() !== spokePool) {
    throw new Error('Across quoted a SpokePool we do not recognise. Refusing it.');
  }

  const outputAmount = body.outputAmount ? BigInt(body.outputAmount) : 0n;
  const relayer = body.exclusiveRelayer?.toLowerCase() ?? '';

  if (
    outputAmount <= 0n ||
    outputAmount > args.inputAmount ||
    !/^0x[0-9a-f]{40}$/.test(relayer) ||
    !body.timestamp ||
    !body.fillDeadline
  ) {
    throw new Error('Across returned a quote we cannot use.');
  }

  return {
    spokePool,
    inputToken,
    outputToken,
    inputAmount: args.inputAmount,
    outputAmount,
    destinationChainId: args.to,
    exclusiveRelayer: relayer as Address,
    quoteTimestamp: Number(body.timestamp),
    fillDeadline: Number(body.fillDeadline),
    exclusivityDeadline: Number(body.exclusivityDeadline ?? 0),
    etaSeconds: body.estimatedFillTimeSec ?? 60,
  };
}

/* -------------------------------------------------------------------------- */
/*  Verifying a deposit                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256
 * inputAmount, uint256 outputAmount, uint256 indexed destinationChainId,
 * uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32
 * exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32
 * exclusiveRelayer, bytes message)` — matched against a real deposit on Arc.
 */
export const FUNDS_DEPOSITED_TOPIC = '0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3';

export interface ExpectedDeposit {
  spokePool: Address;
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  destinationChainId: ChainId;
  depositor: Address;
  recipient: Address;
}

/**
 * Does this receipt contain exactly this deposit? The same standard as a send
 * or a CCTP burn: from this wallet, of this amount, paying out exactly this
 * much of this token, to this wallet, on this chain.
 */
export function containsAcrossDeposit(receipt: Receipt, expected: ExpectedDeposit): boolean {
  if (receipt.status !== 'success') return false;

  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== expected.spokePool.toLowerCase()) return false;
    if (log.topics.length !== 4 || log.topics[0]?.toLowerCase() !== FUNDS_DEPOSITED_TOPIC) return false;
    if (BigInt(log.topics[1] ?? '0x0') !== BigInt(expected.destinationChainId)) return false;
    if (wordAddress(log.topics[3]) !== expected.depositor.toLowerCase()) return false;

    const words = dataWords(log.data);
    // inputToken, outputToken, inputAmount, outputAmount, quoteTimestamp,
    // fillDeadline, exclusivityDeadline, recipient, exclusiveRelayer, …
    if (!words || words.length < 9) return false;

    return (
      wordAddress(`0x${words[0]}`) === expected.inputToken.toLowerCase() &&
      wordAddress(`0x${words[1]}`) === expected.outputToken.toLowerCase() &&
      BigInt(`0x${words[2]}`) === expected.inputAmount &&
      BigInt(`0x${words[3]}`) === expected.outputAmount &&
      wordAddress(`0x${words[7]}`) === expected.recipient.toLowerCase()
    );
  });
}

/** A bytes32 holding an address: the address, or null if the high bytes aren't zero. */
function wordAddress(word: string | undefined): string | null {
  if (!word || !/^0x0{24}[0-9a-fA-F]{40}$/.test(word)) return null;
  return `0x${word.slice(26)}`.toLowerCase();
}

function dataWords(data: string): string[] | null {
  if (!/^0x([0-9a-fA-F]{64})*$/.test(data)) return null;
  return (data.slice(2).toLowerCase().match(/.{64}/g) ?? []) as string[];
}

/* -------------------------------------------------------------------------- */
/*  Swaps: USDC on Arc into another token on another chain                    */
/* -------------------------------------------------------------------------- */

/**
 * Across's handler on each destination: the contract that receives the bridged
 * USDC, runs the swap, and pays the result out. Pinned per chain — a quote
 * paying out anywhere else is refused.
 */
const SWAP_HANDLERS: Partial<Record<ChainId, Address>> = {
  [CHAIN.ethereum]: '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e',
  [CHAIN.optimism]: '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e',
  [CHAIN.unichain]: '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e',
  [CHAIN.polygon]: '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e',
  [CHAIN.base]: '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e',
  [CHAIN.arbitrum]: '0x0f7ae28de1c8532170ad4ee566b5801485c13a0e',
  [CHAIN.avalanche]: '0x9610954acdca5ff7905f051a040ce33fe613c60e',
  [CHAIN.hyperevm]: '0x5e7840e06faccb6d1c3b5f5e0d1d3d07f2829bba',
  // From a live Arc → stock quote's deposit recipient, and checked to have code.
  [CHAIN.robinhood]: '0xa8ad2e87e2043711d8bec77e8bc3e2683c0ab6bd',
  [CHAIN.arc]: '0xa07480456c4ebad7626e4fdf4a180709e238547b',
};

export function acrossSwapHandler(chainId: ChainId): Address | null {
  return SWAP_HANDLERS[chainId] ?? null;
}

/** The address a native gas token is named by in swap quotes. */
export const NATIVE_TOKEN: Address = '0x0000000000000000000000000000000000000000';

const SWAP_DEPOSIT_ABI = parseAbi([
  'function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
]);

const HANDLER_ABI = parseAbi(['function drainLeftoverTokens(address token, address destination)']);

const INSTRUCTIONS = [
  {
    type: 'tuple',
    components: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'callData', type: 'bytes' },
          { name: 'value', type: 'uint256' },
        ],
      },
      { name: 'fallbackRecipient', type: 'address' },
    ],
  },
] as const;

/** `drainLeftoverTokens(address,address)` — the handler paying a token out. */
const DRAIN_SELECTOR = '0xef8738d3';

export interface AcrossSwapQuote {
  spokePool: Address;
  inputAmount: bigint;
  /** The deposit, exactly as Across built it — checked field by field before it is ever offered. */
  depositData: Hex;
  outputToken: Address;
  /** Best estimate of what lands. */
  expectedOut: bigint;
  /** The least that can land; below it the swap reverts and the user gets USDC instead. */
  minOut: bigint;
  etaSeconds: number;
}

/**
 * Quote swapping `inputAmount` of the user's Arc USDC into `outputToken` on
 * another chain, through Across: bridge the USDC, then swap it there.
 *
 * Unlike every other route, part of this calldata is Across's, not ours: the
 * instructions the destination handler runs to swap and pay out. So before it
 * is offered it is taken apart, and refused unless every checkable thing holds:
 *
 *  - it calls the pinned SpokePool, from this wallet, for exactly this USDC;
 *  - it goes to the chosen chain, to Across's pinned handler there;
 *  - if the swap fails, the USDC goes back to the user (`fallbackRecipient`);
 *  - every payout in the instructions goes to the user and nobody else, and
 *    one of them pays out the token asked for.
 *
 * What cannot be checked is the DEX's own swap calldata in the middle — the
 * trust every wallet places in its swap aggregator. The minimum output bounds
 * it: a swap that would land less than `minOut` reverts, and the user gets the
 * USDC back.
 */
export async function fetchAcrossSwapQuote(
  args: { from: ChainId; to: ChainId; inputAmount: bigint; outputToken: Address; recipient: Address },
  fetchImpl: typeof fetch = fetch,
): Promise<AcrossSwapQuote | null> {
  const spokePool = acrossSpokePool(args.from);
  const handler = acrossSwapHandler(args.to);
  if (!spokePool || !handler || args.from === args.to) return null;

  const inputToken = getChain(args.from).usdc;
  if (!inputToken) return null;
  const wallet = args.recipient.toLowerCase();

  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount: args.inputAmount.toString(),
    inputToken,
    originChainId: String(args.from),
    outputToken: args.outputToken,
    destinationChainId: String(args.to),
    depositor: args.recipient,
    recipient: args.recipient,
  });

  const response = await fetchImpl(`${API}/swap/approval?${params}`);
  if (response.status >= 400 && response.status < 500) return null;
  if (!response.ok) throw new Error(`Across swap quote failed with ${response.status}`);

  const body = (await response.json()) as {
    swapTx?: { to?: string; data?: string; chainId?: number; value?: string };
    expectedOutputAmount?: string;
    minOutputAmount?: string;
    expectedFillTime?: number;
  };

  const tx = body.swapTx;
  if (!tx?.data || tx.to?.toLowerCase() !== spokePool) return refuse('not our SpokePool');
  if (tx.chainId !== undefined && tx.chainId !== args.from) return refuse('wrong chain');
  if (tx.value && BigInt(tx.value) !== 0n) return refuse('carries value');

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: SWAP_DEPOSIT_ABI, data: tx.data as Hex });
  } catch {
    return refuse('not a deposit');
  }

  const [depositor, recipient, depositInputToken, , inputAmount, , destinationChainId, , , , , message] = decoded.args;

  if (bytes32Address(depositor) !== wallet) return refuse('deposits from someone else');
  if (bytes32Address(depositInputToken) !== inputToken) return refuse('not Arc USDC');
  if (inputAmount !== args.inputAmount) return refuse('wrong amount');
  if (destinationChainId !== BigInt(args.to)) return refuse('wrong destination');
  if (bytes32Address(recipient) !== handler) return refuse('not the pinned handler');

  checkInstructions(message, { handler, wallet, payoutToken: args.outputToken, swapsOnArrival: true });

  const expectedOut = BigInt(body.expectedOutputAmount ?? '0');
  const minOut = BigInt(body.minOutputAmount ?? '0');
  if (expectedOut <= 0n || minOut <= 0n || minOut > expectedOut) return refuse('unusable amounts');

  return {
    spokePool,
    inputAmount: args.inputAmount,
    depositData: tx.data as Hex,
    outputToken: args.outputToken,
    expectedOut,
    minOut,
    etaSeconds: body.expectedFillTime ?? 60,
  };
}

function refuse(why: string): never {
  throw new Error(`Across swap quote refused: ${why}.`);
}

function bytes32Address(word: Hex): string | null {
  return /^0x0{24}[0-9a-fA-F]{40}$/.test(word) ? `0x${word.slice(26)}`.toLowerCase() : null;
}

/* -------------------------------------------------------------------------- */
/*  Selling a token on another chain for USDC — a gas token, or a stock        */
/* -------------------------------------------------------------------------- */

const SWAP_AND_BRIDGE_ABI = parseAbi([
  'function swapAndBridge(((uint256 amount, address recipient) submissionFees, (address inputToken, bytes32 outputToken, uint256 outputAmount, address depositor, bytes32 recipient, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) depositData, address swapToken, address exchange, uint8 transferType, uint256 swapTokenAmount, uint256 minExpectedInputTokenAmount, bytes routerCalldata, bool enableProportionalAdjustment, address spokePool, uint256 nonce) swapAndDepositData) payable',
]);

export interface AcrossNativeSwapQuote {
  periphery: Address;
  /** What is sold: {@link NATIVE_TOKEN} for the gas token, else an ERC-20 the Periphery is approved to take. */
  inputToken: Address;
  /** What is sold, in its base units — the value the transaction carries when that is the gas token. */
  inputAmount: bigint;
  /** The call exactly as Across built it, after every check below. */
  data: Hex;
  /** USDC on the destination. */
  outputToken: Address;
  expectedOut: bigint;
  minOut: bigint;
  etaSeconds: number;
}

/**
 * Quote selling `inputAmount` of the origin chain's gas token (ETH on
 * Arbitrum, say) for USDC delivered to the user on another chain — how money
 * that was swapped out to another chain comes home.
 *
 * Across swaps on the origin chain through a DEX, then bridges the USDC. The
 * transaction is Across's, so it is taken apart before it is offered, and
 * refused unless:
 *
 *  - it calls the pinned Periphery, with exactly `inputAmount` as value and
 *    as the amount swapped;
 *  - it deposits through the pinned SpokePool on the origin chain;
 *  - it is from this wallet, to this wallet, on the chosen chain, arriving
 *    as that chain's USDC, with no destination instructions;
 *  - it pays nobody a submission fee.
 *
 * The DEX calldata in the middle is the one opaque part; the minimum it must
 * produce is fixed in the call, so a worse swap reverts instead of landing.
 */
export async function fetchAcrossNativeSwapQuote(
  args: { from: ChainId; to: ChainId; inputAmount: bigint; recipient: Address; inputToken?: Address },
  fetchImpl: typeof fetch = fetch,
): Promise<AcrossNativeSwapQuote | null> {
  const periphery = acrossPeriphery(args.from);
  const spokePool = acrossSpokePool(args.from);
  if (!periphery || !spokePool || args.from === args.to || args.inputAmount <= 0n) return null;

  const outputToken = getChain(args.to).usdc;
  if (!outputToken) return null;
  const wallet = args.recipient.toLowerCase();
  const inputToken = (args.inputToken ?? NATIVE_TOKEN).toLowerCase() as Address;
  const sellsNative = inputToken === NATIVE_TOKEN;

  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount: args.inputAmount.toString(),
    inputToken,
    originChainId: String(args.from),
    outputToken,
    destinationChainId: String(args.to),
    depositor: args.recipient,
    recipient: args.recipient,
  });

  const response = await fetchImpl(`${API}/swap/approval?${params}`);
  if (response.status >= 400 && response.status < 500) return null;
  if (!response.ok) throw new Error(`Across swap quote failed with ${response.status}`);

  const body = (await response.json()) as {
    swapTx?: { to?: string; data?: string; chainId?: number; value?: string };
    expectedOutputAmount?: string;
    minOutputAmount?: string;
    expectedFillTime?: number;
  };

  const tx = body.swapTx;
  if (!tx?.data || tx.to?.toLowerCase() !== periphery) return refuse('not the pinned Periphery');
  if (tx.chainId !== undefined && tx.chainId !== args.from) return refuse('wrong chain');
  // The gas token rides as value; a token is pulled by the Periphery, so nothing does.
  if (BigInt(tx.value || '0') !== (sellsNative ? args.inputAmount : 0n)) return refuse('carries the wrong value');

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: SWAP_AND_BRIDGE_ABI, data: tx.data as Hex });
  } catch {
    return refuse('not a swap-and-bridge');
  }

  const [data] = decoded.args;
  const deposit = data.depositData;

  if (data.spokePool.toLowerCase() !== spokePool) return refuse('not the pinned SpokePool');
  if (data.swapTokenAmount !== args.inputAmount) return refuse('swaps a different amount');
  if (!sellsNative && data.swapToken.toLowerCase() !== inputToken) return refuse('sells a different token');
  if (data.submissionFees.amount !== 0n) return refuse('pays a submission fee');
  if (deposit.depositor.toLowerCase() !== wallet) return refuse('deposits for someone else');
  if (bytes32Address(deposit.outputToken) !== outputToken) return refuse('arrives as the wrong token');
  if (deposit.destinationChainId !== BigInt(args.to)) return refuse('wrong destination');

  // Straight to the user, or through Across's pinned handler there — which
  // may do nothing but pay the user out.
  const recipient = bytes32Address(deposit.recipient);
  if (recipient === wallet) {
    if (deposit.message !== '0x') return refuse('carries instructions it does not need');
  } else if (recipient !== null && recipient === acrossSwapHandler(args.to)) {
    checkInstructions(deposit.message, { handler: recipient as Address, wallet, payoutToken: outputToken, swapsOnArrival: false });
  } else {
    return refuse('pays out to someone else');
  }

  const expectedOut = BigInt(body.expectedOutputAmount ?? '0');
  const minOut = BigInt(body.minOutputAmount ?? '0');
  if (expectedOut <= 0n || minOut <= 0n || minOut > expectedOut) return refuse('unusable amounts');

  return {
    periphery,
    inputToken,
    inputAmount: args.inputAmount,
    data: tx.data as Hex,
    outputToken,
    expectedOut,
    minOut,
    etaSeconds: body.expectedFillTime ?? 60,
  };
}

/** ERC-20 calls that move or grant tokens: never allowed in instructions that don't swap. */
const MOVES_TOKENS = new Set(['0x095ea7b3', '0xa9059cbb', '0x23b872dd']);

/**
 * The rules for the instructions Across's handler runs on arrival:
 *
 *  - a refund goes to the user, or nowhere (with no fallback, a failed
 *    payout makes the fill fail, and the deposit is refunded on the origin);
 *  - every payout goes through the pinned handler, to the user;
 *  - one payout is the token asked for;
 *  - where nothing is swapped on arrival, no other call may carry value,
 *    approve, or transfer anything — it can only be a call that cannot touch
 *    the money. Where a swap happens, the DEX's own calls are the trusted part.
 */
function checkInstructions(
  message: Hex,
  rules: { handler: Address; wallet: string; payoutToken: Address; swapsOnArrival: boolean },
): void {
  let instructions;
  try {
    [instructions] = decodeAbiParameters(INSTRUCTIONS, message);
  } catch {
    refuse('unreadable instructions');
  }

  const fallback = instructions.fallbackRecipient.toLowerCase();
  if (fallback !== rules.wallet && fallback !== NATIVE_TOKEN) refuse('refunds would go to someone else');

  let paysOutWanted = false;
  for (const call of instructions.calls) {
    const selector = call.callData.slice(0, 10).toLowerCase();

    if (selector === DRAIN_SELECTOR) {
      if (call.target.toLowerCase() !== rules.handler) refuse('pays out through another contract');
      const { args: drain } = decodeFunctionData({ abi: HANDLER_ABI, data: call.callData });
      if (drain[1].toLowerCase() !== rules.wallet) refuse('pays out to someone else');
      if (drain[0].toLowerCase() === rules.payoutToken.toLowerCase()) paysOutWanted = true;
      continue;
    }

    if (!rules.swapsOnArrival && (call.value !== 0n || MOVES_TOKENS.has(selector))) {
      refuse('moves money it has no reason to');
    }
  }

  if (!paysOutWanted) refuse('never pays out the token asked for');
}
