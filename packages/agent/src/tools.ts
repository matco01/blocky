import type Anthropic from '@anthropic-ai/sdk';
import { BridgeIntentSchema, TransferIntentSchema } from '@blocky/shared';
import { z } from 'zod';
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from './system-prompt';

/**
 * The agent's tools.
 *
 * Every tool but one either reads state or writes something that is not
 * money: a saved contact, a deleted one. None of them move funds, and none of
 * them take free-form data that ends up in a transaction — `save_contact`
 * requires an already-validated address, never a name the model made up.
 *
 * Saving a contact is deliberately *not* the same thing as authorising a
 * send to them: it only makes a label resolvable, and every unattended-send
 * boundary elsewhere in the codebase still asks whether an address is on the
 * user's allowlist, which contacts do not touch. See `evaluatePolicy` and the
 * `recipientAllowlist` field it reads — this file has no way to write to it.
 *
 * Every tool below takes no argument that could name a *different* user —
 * `userId` and the wallet address are bound in a closure server-side, never
 * supplied by the model. A few take an argument that names something else
 * (a token symbol, an address, a contact label), which is fine: the model
 * cannot use those to read or change anyone's data but this user's own.
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
/**
 * The intent types the planner can build today — the only ones worth
 * describing to the model.
 *
 * This schema is sent with every request, so every intent type in it is paid
 * for on every message. Swap is left out until the planner can build one: it
 * was a third of the schema, and the planner refuses it anyway. Validation is
 * unaffected — `parseIntent` still checks proposals against the full
 * `IntentSchema`, so narrowing this only changes what the model is offered.
 */
const OFFERED_INTENTS = z.discriminatedUnion('type', [TransferIntentSchema, BridgeIntentSchema]);

/** The bounds Zod puts on every `int`: true, meaningless to the model, and ~25 tokens a field. */
function withoutSafeIntegerBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSafeIntegerBounds);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, inner]) =>
          !(key === 'minimum' && inner === Number.MIN_SAFE_INTEGER) &&
          !(key === 'maximum' && inner === Number.MAX_SAFE_INTEGER),
      )
      .map(([key, inner]) => [key, withoutSafeIntegerBounds(inner)]),
  );
}

function intentJsonSchema(): Record<string, unknown> {
  const union = withoutSafeIntegerBounds(z.toJSONSchema(OFFERED_INTENTS, { io: 'input' })) as Record<string, unknown>;

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

/** For tools that take nothing — the user and wallet are bound server-side, never supplied by the model. */
const NO_INPUT: Anthropic.Tool['input_schema'] = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

export const PROPOSE_INTENT = 'propose_intent';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_balance',
    description:
      "Everything the user holds: USDC on Arc (what a send spends), and each holding on another chain — USDC moved there, or a gas token like ETH swapped into — with its amount and dollar value, plus the total. Check this before proposing to move money off another chain, so you move the token that is actually there.",
    input_schema: NO_INPUT,
  },
  {
    name: 'get_policy',
    description:
      "The user's spending limits for sends you propose: the most per send (perTxCapUsd), the most per day (dailyCapUsd), which actions and tokens are allowed, and settings for unattended sending — which is not available yet, so every send needs their approval regardless. Describe these in plain words, as spending limits; never use field names or phrases like \"auto-approve threshold\" or \"unattended execution\".",
    input_schema: NO_INPUT,
  },
  {
    name: 'list_contacts',
    description:
      "The user's saved contacts, as labels with addresses. Check this before proposing a transfer to a name — a label the user has not saved will not resolve, and inventing one is not possible. If several contacts could match what the user said, ask which rather than picking.",
    input_schema: NO_INPUT,
  },
  {
    name: 'get_supported_chains',
    description:
      'The chains Blocky knows: chainId, name, whether it is a testnet, whether USDC can be moved there from the user\'s Arc balance (canMoveUsdcHere), and which token pays fees there (gasToken). Use it before proposing a move to another chain — the chainId for the intent comes from here, never from memory — and when the user asks about networks.',
    input_schema: NO_INPUT,
  },
  {
    name: 'get_token_price',
    description:
      'The current USD price of a well-known token (e.g. "BTC", "ETH", "SOL"), from a live market feed. This is market data for the user to read, not something Blocky prices for a transaction — the amount on any transfer card always comes from the planner, never from this. Returns "no price available" for anything not on the curated list; never guess a price for a token this returns nothing for.',
    input_schema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'A token ticker, e.g. "ETH".' } },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'resolve_address',
    description:
      'Resolve an ENS name (anything ending in .eth) to its address, or check an address\'s ENS name, without proposing anything. Use this before save_contact when the user gives you a name rather than a 0x address — save_contact only accepts an address. Also useful to answer "what address is x.eth" directly.',
    input_schema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'A 0x address or an ENS name.' } },
      required: ['input'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_contact',
    description:
      "Save a label for an address, so the user can say the label later instead of the address. Requires a real 0x address — resolve an ENS name first with resolve_address, and never invent an address. This does NOT let you send to this contact unattended; every send still needs the user's approval, or the address on their allowlist, whichever applies. If a label is already saved, this replaces what it points to — check list_contacts first if you are not sure that is what the user wants.",
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'How the user will refer to this address, e.g. "Sam".' },
        address: { type: 'string', description: 'A 0x-prefixed address. Not an ENS name.' },
      },
      required: ['label', 'address'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_contact',
    description: 'Remove a saved contact by its exact label. Confirm with the user first if they only described someone rather than naming the exact saved label.',
    input_schema: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_arc_ecosystem',
    description:
      'What is actually live on Arc right now, ranked by TVL (total value locked) — for questions like "what are the best apps on Arc" or "is there anywhere to lend/stake USDC". No APY or yield figure is included, because there is no reliable one to give yet; if the user asks for a specific rate, say you don\'t have a trustworthy number rather than estimating one. A protocol appearing here is not a recommendation and never a basis for propose_intent — Blocky only sends plain USDC transfers today.',
    input_schema: NO_INPUT,
  },
  {
    name: 'get_recent_activity',
    description:
      `The user's recent sends and received payments — amounts, counterparties, timestamps, and whether each went through. Use this for anything about the past (what did I send, when did I last pay Sam, how much came in this week). It has nothing to do with what a future send would cost — that is the planner's job, not this.`,
    input_schema: NO_INPUT,
  },
  {
    name: PROPOSE_INTENT,
    description:
      'Propose that money move. This does NOT execute — it hands a structured intent to the planner, which builds the real transaction, prices it, and checks it against the user\'s limits. The user then approves it on their phone. Call this once you know exactly what the user wants; ask a clarifying question instead if any of the token, the amount, or the recipient is ambiguous. Two things work today: a USDC transfer on Arc (type "transfer"), and moving the user\'s own USDC from Arc to another chain (type "bridge", toChainId from get_supported_chains) — optionally arriving as that chain\'s gas token (receive) or with a little of it for gas (includeGas). Do not propose type "swap".',
    input_schema: intentJsonSchema() as Anthropic.Tool['input_schema'],
  },
];

