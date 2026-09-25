import { CHAIN, type Address, type ChainId, type Hex } from '@blocky/shared';
import { acrossSpokePool } from './across';
import { isCctpTokenMinter } from './cctp';
import { getChain, usdcUnitsToNative } from './chains';

/**
 * Getting a chain's gas token there: Gas.zip.
 *
 * Gas.zip turns a deposit on one chain into the native gas token on another,
 * paid out from its own inventory within seconds. It is by far the cheapest
 * way to put ETH in a wallet on Base, Ethereum, Arbitrum or Optimism — live on
 * Arc mainnet, $2 of USDC became $1.9993 of ETH on Base. It is built for
 * gas-sized amounts: each route has a ceiling (somewhere between $50 and $200
 * today), and Gas.zip has no HYPE liquidity at all.
 *
 * The deposit is a call to Gas.zip's deposit contract carrying native value —
 * on Arc, native *is* USDC, at 18 decimals. Like every other route, Gas.zip's
 * API supplies prices and limits, never the contract: the address is pinned
 * here, and a quote naming another is refused. The calldata is ours.
 *
 * Verified on Arc mainnet: the contract has code, its `deposit(uint256,bytes32)`
 * selector matches the call Gas.zip's own quote builds, and a 2 USDC deposit
 * from a user wallet simulates cleanly (~24k gas).
 */

const API = 'https://backend.gas.zip/v2';

/** Gas.zip's deposit contract, on each origin we deposit from. */
const DEPOSIT_CONTRACTS: Partial<Record<ChainId, Address>> = {
  [CHAIN.arc]: '0x9e22ebec84c7e4c4bd6d4ae7ff6f4d436d6d8390',
};

/**
 * Gas.zip's own short ids for the chains it delivers to. Read from its
 * `/v2/chains` and pinned: the id is part of what the user signs, so it is not
 * taken from a response at signing time.
 */
const SHORT_IDS: Partial<Record<ChainId, number>> = {
  [CHAIN.ethereum]: 255,
  [CHAIN.optimism]: 55,
  [CHAIN.unichain]: 362,
  [CHAIN.polygon]: 17,
  [CHAIN.base]: 54,
  [CHAIN.arbitrum]: 57,
  [CHAIN.avalanche]: 15,
  [CHAIN.hyperevm]: 430,
};

export function gasZipDepositContract(chainId: ChainId): Address | null {
  return DEPOSIT_CONTRACTS[chainId] ?? null;
}

export function gasZipShortId(chainId: ChainId): number | null {
  return SHORT_IDS[chainId] ?? null;
}

export interface GasZipQuote {
  contract: Address;
  shortId: number;
  /** What leaves, in USDC base units (6 decimals). */
  inputAmount: bigint;
  /** The same amount as the native value the deposit carries (18 decimals on Arc). */
  value: bigint;
  /** What Gas.zip says will land, in the destination gas token's base units. */
  expectedOut: bigint;
  outDecimals: number;
  etaSeconds: number;
}

/**
 * Quote turning `inputAmount` of the user's Arc USDC into the destination's
 * gas token. Null when Gas.zip has no route, no liquidity, or the amount is
 * over its limit — "not this way", never an error. Throws only when the API
 * itself fails.
 */
export async function fetchGasZipQuote(
  args: { from: ChainId; to: ChainId; inputAmount: bigint; recipient: Address },
  fetchImpl: typeof fetch = fetch,
): Promise<GasZipQuote | null> {
  const contract = gasZipDepositContract(args.from);
  const shortId = gasZipShortId(args.to);
  const source = getChain(args.from);

  // The deposit is native value, which only works where native is the USDC
  // being sent — Arc.
  if (!contract || shortId === null || !source.gasPaidInUsdc || args.inputAmount <= 0n) return null;

  const value = usdcUnitsToNative(args.inputAmount);
  const response = await fetchImpl(
    `${API}/quotes/${args.from}/${value}/${args.to}?from=${args.recipient}&to=${args.recipient}`,
  );

  const body = (await response.json().catch(() => null)) as {
    contractDepositTxn?: { to?: string };
    quotes?: Array<{ chain?: number; expected?: number | string; decimals?: number; speed?: number; error?: string }>;
    error?: string;
  } | null;

  const quote = body?.quotes?.[0];

  // No liquidity, over the limit, unsupported pair: Gas.zip answers with an
  // error per quote. That is "no route".
  if (quote?.error || (!response.ok && body?.quotes)) return null;
  if (!response.ok || !body) throw new Error(`Gas.zip quote failed with ${response.status}`);

  if (body.contractDepositTxn?.to?.toLowerCase() !== contract) {
    throw new Error('Gas.zip quoted a deposit contract we do not recognise. Refusing it.');
  }

  if (!quote || quote.chain !== args.to || quote.expected === undefined) {
    throw new Error('Gas.zip returned a quote we cannot use.');
  }

  const expectedOut = BigInt(quote.expected);
  if (expectedOut <= 0n) return null;

  return {
    contract,
    shortId,
    inputAmount: args.inputAmount,
    value,
    expectedOut,
    outDecimals: quote.decimals ?? 18,
    etaSeconds: Math.max(1, Math.round(quote.speed ?? 10)),
  };
}

/** `deposit(uint256 destinationChains, bytes32 to)`. */
const DEPOSIT_SELECTOR = 'c9630cb0';

/**
 * Encode Gas.zip's deposit to one chain: its short id as a plain number, and
 * the recipient in the high 20 bytes of a word — exactly the calldata
 * Gas.zip's own quote builds (checked in the tests).
 */
export function encodeGasZipDeposit(shortId: number, recipient: Address): Hex {
  const bare = recipient.slice(2).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(bare)) throw new Error(`Not a 20-byte address: ${recipient}`);

  return `0x${DEPOSIT_SELECTOR}${shortId.toString(16).padStart(64, '0')}${bare.padEnd(64, '0')}`;
}

/* -------------------------------------------------------------------------- */
/*  Verifying a deposit                                                        */
/* -------------------------------------------------------------------------- */

export interface SentTransaction {
  from: string;
  to: string | null;
  value: bigint;
  input: string;
}

/**
 * Is this transaction exactly the planned deposit? A Gas.zip deposit is a
 * plain call with value, so it is checked on the transaction itself: from the
 * user, to the pinned contract, carrying exactly the planned value and
 * calldata — and it must have succeeded.
 */
export function isGasZipDeposit(
  tx: SentTransaction,
  receiptStatus: 'success' | 'reverted',
  expected: { from: Address; contract: Address; value: bigint; data: Hex },
): boolean {
  return (
    receiptStatus === 'success' &&
    tx.from.toLowerCase() === expected.from.toLowerCase() &&
    tx.to?.toLowerCase() === expected.contract.toLowerCase() &&
    tx.value === expected.value &&
    tx.input.toLowerCase() === expected.data.toLowerCase()
  );
}

/**
 * Whether an address is a contract money leaves through when it moves to
 * another chain — CCTP's minter, an Across SpokePool, or Gas.zip's deposit
 * contract. In someone's history, a payment to one of these is their own
 * money on its way to another chain, not a payment to a stranger.
 */
export function isCrossChainContract(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    isCctpTokenMinter(lower) ||
    Object.values(DEPOSIT_CONTRACTS).includes(lower as Address) ||
    Object.values(CHAIN).some((chainId) => acrossSpokePool(chainId) === lower)
  );
}
