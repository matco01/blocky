import type Anthropic from '@anthropic-ai/sdk';
import { IntentSchema } from '@blocky/shared';
import { z } from 'zod';
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from './system-prompt';

/**
 * The agent's tools.
 *
 * M2 is read-only plus one proposal. Every tool here either reads state the
 * user already has, or produces an Intent that something else has to approve.
 * None of them move money, and none of them take free-form data that ends up
 * in a transaction.
 */

/* -------------------------------------------------------------------------- */
/*  Untrusted content                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Fence attacker-controlled text before it enters the model's context.
 *
 * The inner strip is the part that matters. Without it an attacker names their
 * token `</untrusted-data id="b7f3a1c9">` followed by instructions, closes our
 * fence early, and writes as if they were the system. Removing any occurrence
 * of the markers from the payload makes the fence unclosable from inside.
 */
export function untrusted(value: string): string {
  const stripped = value
    .split(UNTRUSTED_OPEN)
    .join('')
    .split(UNTRUSTED_CLOSE)
    .join('');

  return `${UNTRUSTED_OPEN}${stripped}${UNTRUSTED_CLOSE}`;
}

/**
 * Recursively fence every string in a tool result.
 *
 * Applied to whole payloads rather than hand-picked fields on purpose: a new
 * field added to a balance response later is fenced automatically, instead of
 * being the one unfenced string an attacker eventually finds.
 */
export function untrustedJson(value: unknown): unknown {
  if (typeof value === 'string') return untrusted(value);
  if (Array.isArray(value)) return value.map(untrustedJson);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, untrustedJson(inner)]),
    );
  }

  return value;
}

/* -------------------------------------------------------------------------- */
/*  Tool definitions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The Intent schema, as JSON Schema, generated from the Zod schema itself.
 *
 * Generated rather than hand-written so the two cannot drift. A hand-copied
 * tool schema that has fallen a version behind `intent.ts` is a schema that
 * lets the model express something the validator will reject — or worse,
 * something it will accept for the wrong reason.
 *
 * `io: 'input'` because we want the shape the model must *produce*: fields with
 * defaults (`amountRefersTo`) are optional going in, even though they are
 * always present coming out.
 *
 * Two constraints from the tools API shape the result, both verified against it
 * rather than assumed:
 *
 *  - `oneOf` is rejected at the top level of an `input_schema`, so the union is
 *    nested one level down under `intent`. {@link unwrapIntentInput} undoes that.
 *  - `strict: true` does not support `oneOf` at all, so we cannot have the API
 *    guarantee schema-valid arguments. That is survivable precisely because
 *    `parseIntent` was never going to trust them anyway: a malformed proposal
 *    comes back as validation errors the model gets one chance to fix.
 */
function intentJsonSchema(): Record<string, unknown> {
  const union = z.toJSONSchema(IntentSchema, { io: 'input' }) as Record<string, unknown>;

  // `$schema` is meaningless to the tools API and costs tokens on every request.
  delete union['$schema'];

  return {
    type: 'object',
    properties: { intent: union },
    required: ['intent'],
  };
}

/**
 * Undo the wrapping above.
 *
 * Falls through to the raw input when there is no `intent` key, so a model that
 * sends the union unwrapped still gets validated rather than rejected on a
 * technicality.
 */
export function unwrapIntentInput(input: unknown): unknown {
  if (input !== null && typeof input === 'object' && 'intent' in input) {
    return (input as { intent: unknown }).intent;
  }

  return input;
}

export const PROPOSE_INTENT = 'propose_intent';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_balance',
    description:
      "The user's spendable balance, in USDC and in dollars. One figure across every supported chain — Blocky uses Circle Gateway, so there is no per-chain balance to reconcile and no bridging step to mention.",
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_policy',
    description:
      "The user's agent settings: whether unattended execution is on at all, the per-transaction and daily caps, the auto-approve threshold, which action types are permitted, and which tokens. Check this before telling the user what will happen to a proposal — the same request behaves differently under different settings.",
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'list_contacts',
    description:
      "The user's saved contacts, as labels with addresses. Check this before proposing a transfer to a name — a label the user has not saved will not resolve, and inventing one is not possible. If several contacts could match what the user said, ask which rather than picking.",
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_supported_chains',
    description:
      'The chains Blocky supports, with names and whether each is a testnet. Use this only when the user asks about networks directly; routing is the planner\'s job and not something to raise unprompted.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: PROPOSE_INTENT,
    description:
      'Propose that money move. This does NOT execute — it hands a structured intent to the planner, which builds the real transaction, prices it, and applies the user\'s policy. Depending on that policy the user either approves it with Face ID or it runs unattended within their limits. Call this once you know exactly what the user wants; ask a clarifying question instead if any of the token, the amount, or the recipient is ambiguous.',
    input_schema: intentJsonSchema() as Anthropic.Tool['input_schema'],
  },
];

/** Tools the agent may call and loop on. `propose_intent` is not one — it ends the turn. */
export const READ_ONLY_TOOLS = TOOLS.filter((tool) => tool.name !== PROPOSE_INTENT).map(
  (tool) => tool.name,
);
