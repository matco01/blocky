import { z } from 'zod';
import {
  AmountSpecSchema,
  ChainIdSchema,
  RecipientRefSchema,
  TokenRefSchema,
} from './primitives';

/**
 * Intents: the complete vocabulary of money-moving actions the model can ask for.
 *
 * This file is the safety boundary of the product. The model does not produce
 * calldata, does not choose a contract, does not set gas, and cannot express an
 * action that has no schema here. It states *what the user wants* in structured
 * form; `packages/../planner` decides *how*, deterministically.
 *
 * Consequences worth internalising before adding anything to this union:
 *
 *  - A new intent type is a new thing a compromised or confused model can
 *    attempt. Adding one is a security decision, not a feature decision.
 *  - Never add a passthrough field (`calldata`, `rawTx`, `contractCall`). The
 *    moment one exists, every other guarantee in this codebase is decorative.
 */

const IntentBase = {
  /**
   * The model's own one-line description of what it believes it is doing.
   * Shown in the confirmation card *alongside* — never instead of — the
   * planner's computed summary, so a mismatch is visible to the user.
   */
  rationale: z
    .string()
    .min(1)
    .max(280)
    // The user sees this beside the planner's own summary, as a check on it. A
    // stand-in checks nothing, and has come with careless proposals — send it back.
    .refine((text) => !/^\s*(placeholder|todo|tbd|n\/a|none|test|\.+|-+)\s*$/i.test(text), {
      message: 'Write what you actually mean to do, in a sentence — not a placeholder.',
    }),
};

export const TransferIntentSchema = z.object({
  type: z.literal('transfer'),
  token: TokenRefSchema,
  amount: AmountSpecSchema,
  recipient: RecipientRefSchema,
  /**
   * The chain the money leaves from, and the recipient receives it on.
   * Omitted for Arc, where the user's dollars live; set when paying from a
   * balance on another chain.
   */
  chainId: ChainIdSchema.optional(),
  ...IntentBase,
});

export const SwapIntentSchema = z.object({
  type: z.literal('swap'),
  from: TokenRefSchema,
  to: TokenRefSchema,
  /** Interpreted against `from` unless `amountRefersTo` says otherwise. */
  amount: AmountSpecSchema,
  amountRefersTo: z.enum(['from', 'to']).default('from'),
  /** Basis points. Planner clamps this; the model cannot widen it arbitrarily. */
  maxSlippageBps: z.number().int().min(1).max(500).optional(),
  ...IntentBase,
});

/**
 * Moving the user's own money to another chain — always to their own wallet.
 * `amount` is what leaves; the planner picks the route and shows what lands.
 */
export const BridgeIntentSchema = z.object({
  type: z.literal('bridge'),
  token: TokenRefSchema,
  amount: AmountSpecSchema,
  toChainId: ChainIdSchema,
  fromChainId: ChainIdSchema.optional(),
  /**
   * Arrive as a different token than the one sent — e.g. send USDC, receive
   * ETH on Base, or a stock ("AAPL") on Robinhood Chain. Omit to arrive as the
   * same token. What can be received is the planner's call: an unsupported
   * token is refused, never guessed at.
   */
  receive: TokenRefSchema.optional(),
  /**
   * A little of the destination chain's gas token, so what lands can be moved
   * or sold again. On by default for anything leaving Arc: added when the user
   * holds none there, paid on top of `amount`. `false` only when they said
   * they don't want it.
   */
  includeGas: z.boolean().optional(),
  ...IntentBase,
});

export const IntentSchema = z.discriminatedUnion('type', [
  TransferIntentSchema,
  SwapIntentSchema,
  BridgeIntentSchema,
]);

export type Intent = z.infer<typeof IntentSchema>;
export type IntentType = Intent['type'];
export type TransferIntent = z.infer<typeof TransferIntentSchema>;
export type SwapIntent = z.infer<typeof SwapIntentSchema>;
export type BridgeIntent = z.infer<typeof BridgeIntentSchema>;

export const INTENT_TYPES = ['transfer', 'swap', 'bridge'] as const satisfies readonly IntentType[];

/* -------------------------------------------------------------------------- */
/*  Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type IntentParseResult =
  | { ok: true; intent: Intent }
  | { ok: false; error: string; issues: string[] };

/**
 * Validate raw model output into an `Intent`.
 *
 * Returns a result instead of throwing, and — importantly — never coerces. If
 * the model emits something malformed we hand the error back to it and let it
 * try again. Quietly "fixing" a bad amount or a truncated address is how you
 * ship a wallet that sends money to the wrong place.
 */
export function parseIntent(input: unknown): IntentParseResult {
  const result = IntentSchema.safeParse(input);

  if (result.success) {
    return { ok: true, intent: result.data };
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return {
    ok: false,
    error: `Intent failed validation: ${issues.join('; ')}`,
    issues,
  };
}
