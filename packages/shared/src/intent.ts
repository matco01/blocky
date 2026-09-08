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
  rationale: z.string().min(1).max(280),
};

export const TransferIntentSchema = z.object({
  type: z.literal('transfer'),
  token: TokenRefSchema,
  amount: AmountSpecSchema,
  recipient: RecipientRefSchema,
  /**
   * Normally omitted. The unified USDC balance means the planner picks the
   * cheapest chain; the model should only pin this if the user explicitly asked
   * for a specific network.
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

export const BridgeIntentSchema = z.object({
  type: z.literal('bridge'),
  token: TokenRefSchema,
  amount: AmountSpecSchema,
  toChainId: ChainIdSchema,
  fromChainId: ChainIdSchema.optional(),
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
