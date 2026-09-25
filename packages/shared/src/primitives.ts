import { z } from 'zod';
import { isDecimalString } from './money';

/* -------------------------------------------------------------------------- */
/*  Chains                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The chains we speak. Scoped to Circle Gateway's supported set, because the
 * unified USDC balance is the product and a chain outside that set would
 * reintroduce the bridging UX we are trying to delete.
 */
export const CHAIN = {
  ethereum: 1,
  optimism: 10,
  unichain: 130,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  /**
   * Arc — Circle's L1, where USDC is the native gas token. The home chain: a
   * user holding only USDC can pay gas here and needs nothing else.
   */
  arc: 5042,

  // Testnets.
  /** Arc testnet: the same chain, for development. */
  arcTestnet: 5042002,
  baseSepolia: 84532,
  arbitrumSepolia: 421614,
} as const;

export type ChainName = keyof typeof CHAIN;
export type ChainId = (typeof CHAIN)[ChainName];

const CHAIN_IDS = new Set<number>(Object.values(CHAIN));

export function isChainId(value: number): value is ChainId {
  return CHAIN_IDS.has(value);
}

export const ChainIdSchema = z
  .number()
  .int()
  .refine(isChainId, { error: (issue) => `Unsupported chain id: ${String(issue.input)}` })
  .transform((value) => value as ChainId);

/* -------------------------------------------------------------------------- */
/*  Ethereum scalars                                                           */
/* -------------------------------------------------------------------------- */

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 20-byte address')
  // Normalise case so allowlist comparisons are never checksum-sensitive.
  .transform((value) => value.toLowerCase() as Address);

export type Address = `0x${string}`;

/**
 * `0x1234…abcd` — for the places an address has to be shown but no name is
 * known. One definition, so the app and the API's confirmation-card text
 * always shorten the same way. Wider views (the full review screen) pass more
 * characters rather than rolling their own.
 */
export function shortAddress(address: string, head = 6, tail = 4): string {
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export const HexSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/, 'Must be 0x-prefixed hex with an even number of digits');

export type Hex = `0x${string}`;

/** A non-negative integer in a token's smallest unit, as a string. */
export const BaseUnitsSchema = z.string().regex(/^\d+$/, 'Must be a whole number of base units');

/** A non-negative human-readable decimal amount, e.g. "0.05" or "20". */
export const DecimalSchema = z
  .string()
  .refine(isDecimalString, 'Must be a non-negative decimal number, e.g. "12.34"');

/* -------------------------------------------------------------------------- */
/*  References the model is allowed to produce                                 */
/* -------------------------------------------------------------------------- */

/**
 * How the agent names a token.
 *
 * It may use a symbol ("USDC") — resolution to a real contract is the planner's
 * job, not the model's, and ambiguous symbols come back as a clarifying
 * question rather than a guess. An explicit address is allowed but always
 * carries an `unverified_token` warning downstream.
 */
export const TokenRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('symbol'),
    symbol: z.string().min(1).max(20),
  }),
  z.object({
    kind: z.literal('address'),
    address: AddressSchema,
    chainId: ChainIdSchema,
  }),
]);

export type TokenRef = z.infer<typeof TokenRefSchema>;

/**
 * How the agent names a destination.
 *
 * Note there is no free-text option. The model cannot invent a destination
 * string; it picks one of these shapes and the planner resolves it against real
 * data. A resolved recipient that is not already on the user's allowlist
 * requires explicit confirmation regardless of amount — see `policy.ts`.
 */
export const RecipientRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('address'), address: AddressSchema }),
  z.object({ kind: z.literal('ens'), name: z.string().min(3).max(255) }),
  /** A label from the user's own saved contacts. */
  z.object({ kind: z.literal('contact'), label: z.string().min(1).max(64) }),
  /** The user's own wallet — used for self-transfers between chains. */
  z.object({ kind: z.literal('self') }),
]);

export type RecipientRef = z.infer<typeof RecipientRefSchema>;

/**
 * How the agent expresses "how much".
 *
 * Users say "send twenty bucks" far more often than "send 20.000000 USDC", so
 * USD is a first-class input and the planner converts it at quote time.
 */
export const AmountSpecSchema = z.discriminatedUnion('kind', [
  /** An amount denominated in the token itself, e.g. 0.05 ETH. */
  z.object({ kind: z.literal('token'), value: DecimalSchema }),
  /** An amount denominated in dollars, e.g. $20 worth. */
  z.object({ kind: z.literal('usd'), value: DecimalSchema }),
  /** The entire balance, net of fees. The planner works out what that means. */
  z.object({ kind: z.literal('max') }),
]);

export type AmountSpec = z.infer<typeof AmountSpecSchema>;

/* -------------------------------------------------------------------------- */
/*  Resolved forms — produced by the planner, never by the model               */
/* -------------------------------------------------------------------------- */

export const ResolvedTokenSchema = z.object({
  chainId: ChainIdSchema,
  address: AddressSchema,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().min(0).max(36),
  logoUrl: z.string().url().nullable(),
  /** False for anything not on our curated list; drives the unverified warning. */
  verified: z.boolean(),
});

export type ResolvedToken = z.infer<typeof ResolvedTokenSchema>;

export const ResolvedRecipientSchema = z.object({
  address: AddressSchema,
  /** What we show the user: an ENS name, a contact label, or a truncated address. */
  display: z.string(),
  ensName: z.string().nullable(),
  contactLabel: z.string().nullable(),
  /** True if this address is already on the user's allowlist. */
  known: z.boolean(),
  /** True if the address has code — worth flagging before a plain transfer. */
  isContract: z.boolean(),
});

export type ResolvedRecipient = z.infer<typeof ResolvedRecipientSchema>;
