import type { Address, ChainId, Hex } from '@blocky/shared';
import { getChain } from './chains';
import type { Receipt } from './receipts';

/**
 * Moving USDC between chains: Circle's CCTP v2, with its Forwarding Service.
 *
 * CCTP burns USDC on the source chain and mints the same amount on the
 * destination — native USDC both ends, no wrapped token, no liquidity pool. A
 * plain CCTP transfer then needs someone to submit the mint on the destination,
 * and that someone pays gas there: exactly the gas token a Blocky user moving
 * money to a new chain does not have yet.
 *
 * The Forwarding Service closes that gap without anybody sponsoring anything.
 * Circle submits the mint and takes its cost out of the transfer, in USDC. So
 * the user pays every fee from the USDC they already hold on Arc — Arc gas for
 * the burn, and the transfer fee out of the amount — and the destination needs
 * nothing from them at all. What it does not do is leave them gas to spend the
 * USDC once it lands; that is what the planner's destination warning is for.
 *
 * Contract addresses and the burn event were verified against the live
 * chains — Arc, Base Sepolia and Arbitrum Sepolia for testnet; Arc and every
 * mainnet destination for mainnet — not only the docs. A guessed contract
 * address here is a burn nobody mints.
 */

interface CctpContracts {
  /** TokenMessengerV2: what the user's account calls to burn. The same address on every chain of a network. */
  tokenMessenger: Address;
  /** TokenMinterV2: receives the USDC from the user and burns it. Also one address per network. */
  tokenMinter: Address;
  /** Circle's attestation API. */
  api: string;
}

const CCTP: { testnet: CctpContracts; mainnet: CctpContracts } = {
  testnet: {
    tokenMessenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    tokenMinter: '0xb43db544e2c27092c107639ad201b3defabcf192',
    api: 'https://iris-api-sandbox.circle.com',
  },
  // Checked on Arc and on Ethereum, OP, Unichain, Polygon, Base, Arbitrum and
  // Avalanche: the messenger has code and reports this minter on every one.
  mainnet: {
    tokenMessenger: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
    tokenMinter: '0xfd78ee919681417d192449715b2594ab58f5d002',
    api: 'https://iris-api.circle.com',
  },
};

/** The contracts for a chain's network, or null where CCTP is not verified for it. */
export function cctpContracts(chainId: ChainId): CctpContracts | null {
  const chain = getChain(chainId);
  if (chain.circleDomain === null) return null;
  return chain.testnet ? CCTP.testnet : CCTP.mainnet;
}

/**
 * Whether an address is CCTP's minter — where USDC goes to be burned. A
 * transfer to it in someone's history is money they moved to another chain.
 */
export function isCctpTokenMinter(address: string): boolean {
  const lower = address.toLowerCase();
  return [CCTP.testnet, CCTP.mainnet].some((contracts) => contracts.tokenMinter === lower);
}

/** Whether USDC can move from one chain to the other through CCTP. */
export function canMoveUsdcBetween(from: ChainId, to: ChainId): boolean {
  if (from === to) return false;
  const source = cctpContracts(from);
  return source !== null && source === cctpContracts(to);
}

/**
 * Hook data that asks for the Forwarding Service: the magic bytes
 * "cctp-forward" padded to 24 bytes, hook version 0, and no extra data. Taken
 * verbatim from Circle's documentation for EVM destinations.
 */
export const CCTP_FORWARD_HOOK_DATA: Hex = '0x636374702d666f72776172640000000000000000000000000000000000000000';

/** Fast Transfer: minted in seconds rather than after full source finality. */
export const CCTP_FAST_FINALITY = 1000;

/** Basis points are expressed in hundredths here, to keep fractional bps exact. */
const CENTI_BPS_DENOMINATOR = 1_000_000n;

export interface CctpFees {
  /** What the Forwarding Service charges to submit the mint, in USDC base units. */
  forwardFee: bigint;
  /** Circle's protocol fee, in hundredths of a basis point of the burned amount. */
  protocolFeeCentiBps: bigint;
}

/**
 * The fees for a Fast Transfer with forwarding, from Circle's own API.
 *
 * Uses the *high* forwarding estimate. The fee the user approves is a ceiling
 * (`maxFee`), and one set too low is not a cheaper transfer — Circle skips the
 * mint, and the USDC sits waiting for someone to pay destination gas to claim
 * it. Whatever the ceiling does not use arrives with the transfer.
 *
 * Throws on a network or API failure; the caller turns that into "not
 * available right now", never into a fee of zero.
 */
export async function fetchCctpFees(
  from: ChainId,
  to: ChainId,
  fetchImpl: typeof fetch = fetch,
): Promise<CctpFees> {
  const contracts = cctpContracts(from);
  const sourceDomain = getChain(from).circleDomain;
  const destinationDomain = getChain(to).circleDomain;

  if (!contracts || sourceDomain === null || destinationDomain === null || !canMoveUsdcBetween(from, to)) {
    throw new Error('CCTP does not connect those chains.');
  }

  const response = await fetchImpl(
    `${contracts.api}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}?forward=true`,
  );

  if (!response.ok) {
    throw new Error(`CCTP fee request failed with ${response.status}`);
  }

  const body = (await response.json()) as Array<{
    finalityThreshold?: number;
    minimumFee?: number;
    forwardFee?: { low?: number; med?: number; high?: number };
  }>;

  const fast = Array.isArray(body) ? body.find((entry) => entry.finalityThreshold === CCTP_FAST_FINALITY) : undefined;
  const forward = fast?.forwardFee?.high;
  const minimum = fast?.minimumFee;

  // Missing or garbled numbers are "unavailable", not zero: a zero forward fee
  // is a transfer Circle will not deliver.
  if (!Number.isSafeInteger(forward) || forward! <= 0 || typeof minimum !== 'number' || !(minimum >= 0)) {
    throw new Error('CCTP returned no usable fee for a forwarded transfer.');
  }

  return {
    forwardFee: BigInt(forward!),
    protocolFeeCentiBps: BigInt(Math.ceil(minimum * 100)),
  };
}

/** Division that rounds up. Every fee here rounds against us, never the user's delivery. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * How much to burn so that at least `arrive` lands, and the `maxFee` to allow.
 *
 * The protocol fee is charged on the burned amount, which includes the fee
 * itself; solving for that exactly (rather than approximating on `arrive`)
 * is what keeps the delivered amount from coming up a unit short.
 */
export function cctpBurnForArrival(arrive: bigint, fees: CctpFees): { burn: bigint; maxFee: bigint } {
  if (arrive <= 0n) throw new Error('Nothing to move.');

  const base = arrive + fees.forwardFee;
  const protocol = ceilDiv(base * fees.protocolFeeCentiBps, CENTI_BPS_DENOMINATOR - fees.protocolFeeCentiBps);
  const maxFee = fees.forwardFee + protocol;

  return { burn: arrive + maxFee, maxFee };
}

/** For "move everything": what arrives when `burn` is all there is. Null when fees eat all of it. */
export function cctpArrivalForBurn(burn: bigint, fees: CctpFees): { arrive: bigint; maxFee: bigint } | null {
  const maxFee = fees.forwardFee + ceilDiv(burn * fees.protocolFeeCentiBps, CENTI_BPS_DENOMINATOR);
  const arrive = burn - maxFee;

  return arrive > 0n ? { arrive, maxFee } : null;
}

/* -------------------------------------------------------------------------- */
/*  Verifying a burn                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `DepositForBurn(address indexed burnToken, uint256 amount, address indexed
 * depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32
 * destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32
 * indexed minFinalityThreshold, bytes hookData)` — matched against a real burn
 * on Arc testnet.
 */
export const DEPOSIT_FOR_BURN_TOPIC = '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5';

export interface ExpectedBurn {
  messenger: Address;
  burnToken: Address;
  depositor: Address;
  /** The exact amount burned, in USDC base units. */
  amount: bigint;
  mintRecipient: Address;
  destinationDomain: number;
  /** The most the user agreed Circle may take. */
  maxFee: bigint;
}

/**
 * Does this receipt contain exactly this burn?
 *
 * The same standard the transfer check holds: not "some CCTP activity", but
 * the burn the plan describes — from this account, of this amount, to this
 * recipient, on this destination, with no more fee allowed than the user saw.
 * A receipt that burns to anyone or anywhere else is not this plan.
 */
export function containsCctpBurn(receipt: Receipt, expected: ExpectedBurn): boolean {
  if (receipt.status !== 'success') return false;

  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== expected.messenger.toLowerCase()) return false;
    if (log.topics.length !== 4 || log.topics[0]?.toLowerCase() !== DEPOSIT_FOR_BURN_TOPIC) return false;
    if (topicAddress(log.topics[1]) !== expected.burnToken.toLowerCase()) return false;
    if (topicAddress(log.topics[2]) !== expected.depositor.toLowerCase()) return false;

    const words = dataWords(log.data);
    // amount, mintRecipient, destinationDomain, destinationTokenMessenger,
    // destinationCaller, maxFee, then the hook data's offset.
    if (!words || words.length < 7) return false;

    return (
      BigInt(`0x${words[0]}`) === expected.amount &&
      `0x${words[1]!.slice(24)}` === expected.mintRecipient.toLowerCase() &&
      /^0{24}/.test(words[1]!) &&
      BigInt(`0x${words[2]}`) === BigInt(expected.destinationDomain) &&
      BigInt(`0x${words[5]}`) <= expected.maxFee
    );
  });
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(26)}`.toLowerCase();
}

function dataWords(data: string): string[] | null {
  if (!/^0x([0-9a-fA-F]{64})*$/.test(data)) return null;
  return (data.slice(2).toLowerCase().match(/.{64}/g) ?? []) as string[];
}
