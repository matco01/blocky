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

/** The SpokePool on each origin chain we deposit from. */
const SPOKE_POOLS: Partial<Record<ChainId, Address>> = {
  [CHAIN.arc]: '0x9b4a302a548c7e313c2b74c461db7b84d3074a84',
};

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

  let instructions;
  try {
    [instructions] = decodeAbiParameters(INSTRUCTIONS, message);
  } catch {
    return refuse('unreadable instructions');
  }

  if (instructions.fallbackRecipient.toLowerCase() !== wallet) return refuse('refunds would go to someone else');

  let paysOutWanted = false;
  for (const call of instructions.calls) {
    if (call.callData.slice(0, 10).toLowerCase() !== DRAIN_SELECTOR) continue;
    if (call.target.toLowerCase() !== handler) return refuse('pays out through another contract');

    const { args: drain } = decodeFunctionData({ abi: HANDLER_ABI, data: call.callData });
    if (drain[1].toLowerCase() !== wallet) return refuse('pays out to someone else');
    if (drain[0].toLowerCase() === args.outputToken.toLowerCase()) paysOutWanted = true;
  }

  if (!paysOutWanted) return refuse('never pays out the token asked for');

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
