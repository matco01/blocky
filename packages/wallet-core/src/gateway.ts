import { formatUsd, parseUsd, type Address, type ChainId, type Hex } from '@blocky/shared';
import { CHAINS } from './chains';

/**
 * Circle Gateway balances.
 *
 * Read-only for now. Gateway holds USDC a user has *deposited* into its wallet
 * contract, which is separate from the USDC sitting in their own wallet —
 * adding the two is not double counting. But Gateway funds are not spendable by
 * a plain transfer: moving them needs a burn intent and a `gatewayMint`, which
 * is not built yet. So this is reported alongside the spendable balance, never
 * folded into it. A balance the Send button cannot spend is a confirmation card
 * that fails.
 *
 * Request and response shapes verified against the live testnet API.
 */

export const GATEWAY_API = {
  testnet: 'https://gateway-api-testnet.circle.com/v1',
  mainnet: 'https://gateway-api.circle.com/v1',
} as const;

export interface GatewayBalance {
  chainId: ChainId;
  domain: number;
  /** USD decimal string. USDC is a dollar. */
  balanceUsd: string;
  /** Deposits Gateway has seen but not yet made available. */
  pendingUsd: string;
}

export interface GatewayBalances {
  totalUsd: string;
  perChain: GatewayBalance[];
}

interface ApiResponse {
  balances?: Array<{ domain: number; balance: string; pendingBatch?: string }>;
}

/**
 * Fetch a depositor's Gateway balances on every chain we have a verified domain
 * for.
 *
 * Throws on a network or API failure. The caller decides what "unavailable"
 * looks like — silently returning zero would tell the user their money is gone.
 */
export async function fetchGatewayBalances(
  depositor: Address,
  options: { testnet: boolean; fetch?: typeof fetch },
): Promise<GatewayBalances> {
  const doFetch = options.fetch ?? fetch;

  const chains = Object.values(CHAINS).filter(
    (chain) => chain.gateway && chain.testnet === options.testnet && chain.gatewayDomain !== null,
  );

  if (chains.length === 0) return { totalUsd: '0', perChain: [] };

  const response = await doFetch(`${options.testnet ? GATEWAY_API.testnet : GATEWAY_API.mainnet}/balances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: chains.map((chain) => ({ domain: chain.gatewayDomain, depositor })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Gateway balances request failed with ${response.status}`);
  }

  const body = (await response.json()) as ApiResponse;

  const perChain: GatewayBalance[] = [];
  let total = 0n;

  for (const entry of body.balances ?? []) {
    const chain = chains.find((c) => c.gatewayDomain === entry.domain);
    if (!chain) continue;

    // parseUsd rejects anything that is not a plain decimal, so a malformed
    // response throws here rather than being coerced into a number.
    const balance = parseUsd(entry.balance);
    const pending = parseUsd(entry.pendingBatch ?? '0');

    total += balance;
    perChain.push({
      chainId: chain.id,
      domain: entry.domain,
      balanceUsd: formatUsd(balance),
      pendingUsd: formatUsd(pending),
    });
  }

  return { totalUsd: formatUsd(total), perChain };
}

/* -------------------------------------------------------------------------- */
/*  Moving Gateway funds: burn intents                                         */
/* -------------------------------------------------------------------------- */

/**
 * Gateway's own account of itself: which domains it serves, the contracts on
 * each, and how long a burn intent stays valid there.
 *
 * Read rather than hardcoded. Circle adds domains (Arc arrived as 26) and the
 * expiration height moves every block, so a table baked into this repo would be
 * wrong by the time anyone read it.
 */
export interface GatewayDomainInfo {
  domain: number;
  chain: string;
  network: string;
  walletContract: Address;
  minterContract: Address;
  /** Block height on that domain past which a burn intent is no longer accepted. */
  burnIntentExpirationHeight: bigint;
}

export async function fetchGatewayInfo(options: {
  testnet: boolean;
  fetch?: typeof fetch;
}): Promise<GatewayDomainInfo[]> {
  const doFetch = options.fetch ?? fetch;
  const base = options.testnet ? GATEWAY_API.testnet : GATEWAY_API.mainnet;

  const response = await doFetch(`${base}/info`);

  if (!response.ok) {
    throw new Error(`Gateway info request failed with ${response.status}`);
  }

  const body = (await response.json()) as {
    domains?: Array<{
      domain: number;
      chain: string;
      network: string;
      walletContract?: { address: string };
      minterContract?: { address: string };
      burnIntentExpirationHeight?: string;
    }>;
  };

  const domains: GatewayDomainInfo[] = [];

  for (const entry of body.domains ?? []) {
    const wallet = entry.walletContract?.address;
    const minter = entry.minterContract?.address;

    // Solana's domain is in this list too, with base58 addresses. Skip anything
    // that is not a 20-byte EVM address rather than trying to coerce it.
    if (!wallet || !minter || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) continue;

    domains.push({
      domain: entry.domain,
      chain: entry.chain,
      network: entry.network,
      walletContract: wallet.toLowerCase() as Address,
      minterContract: minter.toLowerCase() as Address,
      burnIntentExpirationHeight: BigInt(entry.burnIntentExpirationHeight ?? '0'),
    });
  }

  return domains;
}

/**
 * The EIP-712 types for a burn intent.
 *
 * Copied from Circle's specification exactly, field order included. These are
 * hashed into the signature: a renamed field or a reordered struct produces a
 * different digest, which Gateway rejects — and if it ever did not, it would be
 * a signature over something other than what the user was shown. Do not tidy
 * this.
 */
export const BURN_INTENT_TYPES = {
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
} as const;

/** Circle's EIP-712 domain for burn intents. No chainId or verifyingContract. */
export const BURN_INTENT_DOMAIN = { name: 'GatewayWallet', version: '1' } as const;

export const TRANSFER_SPEC_VERSION = 1;

export interface TransferSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Hex;
  destinationContract: Hex;
  sourceToken: Hex;
  destinationToken: Hex;
  sourceDepositor: Hex;
  destinationRecipient: Hex;
  sourceSigner: Hex;
  destinationCaller: Hex;
  value: bigint;
  salt: Hex;
  hookData: Hex;
}

export interface BurnIntent {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: TransferSpec;
}

/** Left-pad an address into the bytes32 form every TransferSpec field uses. */
function toBytes32(address: Address): Hex {
  return `0x${address.toLowerCase().slice(2).padStart(64, '0')}`;
}

/**
 * Build the burn intent for moving Gateway funds to another domain.
 *
 * Pure, so the exact bytes a user signs can be asserted in a test rather than
 * discovered in production. Everything that decides where the money goes —
 * domains, recipient, value — is an argument; nothing is inferred here.
 */
export function buildBurnIntent(args: {
  source: GatewayDomainInfo;
  destination: GatewayDomainInfo;
  sourceUsdc: Address;
  destinationUsdc: Address;
  /** The account that deposited into Gateway, and that signs this intent. */
  depositor: Address;
  recipient: Address;
  /** Amount in USDC base units (6 decimals), whatever the chain's native scale. */
  value: bigint;
  /** The most Circle may take as a fee, in USDC base units. */
  maxFee: bigint;
  /** 32 random bytes. Caller supplies it so tests can be deterministic. */
  salt: Hex;
  /**
   * Who may submit the mint. Defaults to the recipient rather than the zero
   * address: a zero `destinationCaller` lets anyone on the internet submit the
   * attestation, and while they cannot redirect the funds, they choose the
   * moment it lands and who pays the gas.
   */
  destinationCaller?: Address;
}): BurnIntent {
  return {
    /*
     * Bounded, not maxUint256. Circle's examples use an unbounded height, which
     * makes a signed intent valid forever — a signature lifted off a device
     * months later would still mint. The API tells us when the domain stops
     * accepting it; use that.
     */
    maxBlockHeight: args.source.burnIntentExpirationHeight,
    maxFee: args.maxFee,
    spec: {
      version: TRANSFER_SPEC_VERSION,
      sourceDomain: args.source.domain,
      destinationDomain: args.destination.domain,
      sourceContract: toBytes32(args.source.walletContract),
      destinationContract: toBytes32(args.destination.minterContract),
      sourceToken: toBytes32(args.sourceUsdc),
      destinationToken: toBytes32(args.destinationUsdc),
      sourceDepositor: toBytes32(args.depositor),
      destinationRecipient: toBytes32(args.recipient),
      sourceSigner: toBytes32(args.depositor),
      destinationCaller: toBytes32(args.destinationCaller ?? args.recipient),
      value: args.value,
      salt: args.salt,
      hookData: '0x',
    },
  };
}

/** The EIP-712 payload to hand a signer. */
export function burnIntentTypedData(intent: BurnIntent) {
  return {
    domain: BURN_INTENT_DOMAIN,
    types: BURN_INTENT_TYPES,
    primaryType: 'BurnIntent' as const,
    message: intent,
  };
}

export interface GatewayAttestation {
  attestation: Hex;
  signature: Hex;
}

/**
 * Exchange a signed burn intent for an attestation.
 *
 * The attestation is what the minter contract trusts. Until this call returns,
 * nothing has moved: the signature alone does not burn anything, which is why
 * the plan the user approved can be built before it.
 */
export async function requestGatewayTransfer(
  signed: { burnIntent: BurnIntent; signature: Hex },
  options: { testnet: boolean; fetch?: typeof fetch },
): Promise<GatewayAttestation> {
  const doFetch = options.fetch ?? fetch;
  const base = options.testnet ? GATEWAY_API.testnet : GATEWAY_API.mainnet;

  const response = await doFetch(`${base}/transfer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // A JSON array: Gateway takes up to 16 intents per request. We send one —
    // batching several burns behind a single approval would mean the user
    // approved a total rather than each movement.
    body: JSON.stringify([
      { burnIntent: serialiseBurnIntent(signed.burnIntent), signature: signed.signature },
    ]),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gateway transfer failed with ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const body = (await response.json()) as { attestation?: string; signature?: string };

  if (!body.attestation || !body.signature) {
    throw new Error('Gateway returned no attestation for that transfer.');
  }

  return { attestation: body.attestation as Hex, signature: body.signature as Hex };
}

/** bigints have no JSON representation; Gateway expects them as decimal strings. */
function serialiseBurnIntent(intent: BurnIntent): Record<string, unknown> {
  return {
    maxBlockHeight: intent.maxBlockHeight.toString(),
    maxFee: intent.maxFee.toString(),
    spec: { ...intent.spec, value: intent.spec.value.toString() },
  };
}
