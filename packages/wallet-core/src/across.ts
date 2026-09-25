import { CHAIN, type Address, type ChainId } from '@blocky/shared';
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
