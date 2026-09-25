import Anthropic from '@anthropic-ai/sdk';
import { parseIntent, type Intent } from '@blocky/shared';
import { SYSTEM_PROMPT } from './system-prompt';
import { PROPOSE_INTENT, TOOLS, untrustedJson, unwrapIntentInput } from './tools';

/**
 * The agent loop.
 *
 * Written by hand rather than with the SDK's tool runner, for one reason:
 * `propose_intent` is *terminal once it plans*. A proposal the planner can
 * build ends the turn — the card goes to the user, and whether it happens is
 * the user's decision, not the model's to observe. A proposal the planner
 * refuses goes back to the model with the reason, so it can fix what it got
 * wrong (the wrong chain, too much) or explain in its own words — rather than
 * the user reading the planner's one-liner under a reply that promised a card.
 * A runner that loops until the model stops wanting tools has neither shape.
 */

/** Sonnet 5 at low effort. Intent extraction is closer to classification than reasoning. */
export const AGENT_MODEL = 'claude-sonnet-5';
export const AGENT_EFFORT = 'low' as const;

/**
 * Ceiling per model turn.
 *
 * Generous for a task whose output is a sentence and a small JSON object, but
 * not unbounded — a runaway turn is a cost incident, and truncation mid
 * tool-call is a broken turn rather than a cheap one.
 */
const MAX_TOKENS = 4096;

/** Tool round-trips before we stop. Prevents a loop from billing indefinitely. */
const MAX_STEPS = 6;

/**
 * Refusals from the planner handed back before we stop trying. One fix is
 * usually all it takes; a second refusal is a sign to explain, not to guess.
 */
const MAX_PLAN_RETRIES = 2;

/**
 * Retries offered to the model when its intent fails validation.
 *
 * We hand the validation errors back and let it fix them, per the contract in
 * `intent.ts` — we never coerce. Two attempts, then we surface the failure
 * rather than burning money on a model that cannot produce a well-formed
 * intent.
 */
const MAX_INTENT_RETRIES = 2;

/* -------------------------------------------------------------------------- */
/*  The seam the API implements                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the agent may see and touch.
 *
 * Deliberately narrow. `saveContact` and `deleteContact` are the only two that
 * change anything, and both are scoped to the calling user's own contact book —
 * never funds, never the recipient allowlist that governs unattended sends.
 * Every argument here names a token, an address, or a label; none of them can
 * name a different user, because the implementation binds that server-side.
 */
export interface AgentTools {
  getBalance(): Promise<unknown>;
  getPolicy(): Promise<unknown>;
  getSupportedChains(): Promise<unknown>;
  listContacts(): Promise<unknown>;
  getTokenPrice(symbol: string): Promise<unknown>;
  resolveAddress(input: string): Promise<unknown>;
  saveContact(label: string, address: string): Promise<unknown>;
  deleteContact(label: string): Promise<unknown>;
  getRecentActivity(): Promise<unknown>;
  getArcEcosystem(): Promise<unknown>;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from cache at ~10% of input cost. Zero here means caching is broken. */
  cacheReadTokens: number;
  /** Every cache write, whatever its lifetime. */
  cacheWriteTokens: number;
  /** The part of `cacheWriteTokens` written with the one-hour TTL, which costs more to write. */
  cacheWrite1hTokens: number;
  /** Model turns billed. A turn that called tools costs more than one. */
  steps: number;
}

/**
 * The planner, as the loop sees it: an intent in, a plan or the reason there
 * is none out. The reason goes back to the model, so it must be something the
 * model may read — the planner's own words, never anything a stranger wrote.
 */
export type PlanIntent<P> = (intent: Intent) => Promise<{ ok: true; plan: P } | { ok: false; message: string }>;

export type AgentTurn<P = unknown> =
  /** The agent answered. Nothing is proposed. */
  | { kind: 'reply'; text: string; usage: AgentUsage }
  /** A valid intent, and — when a planner was given — its plan. Nothing has executed. */
  | { kind: 'intent'; intent: Intent; plan: P | null; text: string; usage: AgentUsage }
  /** The planner kept refusing what the model proposed. `reason` is the planner's last word. */
  | { kind: 'cannot_plan'; reason: string; text: string; usage: AgentUsage }
  /** The model could not produce a well-formed intent. Do not repair it — surface it. */
  | { kind: 'invalid_intent'; error: string; issues: string[]; text: string; usage: AgentUsage }
  /** The loop ran out of steps. */
  | { kind: 'exhausted'; text: string; usage: AgentUsage };

export interface AgentOptions<P> {
  client: Anthropic;
  tools: AgentTools;
  /** Plan each proposal inside the turn, handing refusals back to the model. Without it, a proposal ends the turn unplanned. */
  plan?: PlanIntent<P>;
  /** Prior turns. The API is stateless, so the caller owns the history. */
  history?: Anthropic.MessageParam[];
}

/* -------------------------------------------------------------------------- */
/*  Loop                                                                       */
/* -------------------------------------------------------------------------- */

export async function runAgentTurn<P = unknown>(
  message: string,
  { client, tools, plan, history = [] }: AgentOptions<P>,
): Promise<AgentTurn<P>> {
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: message }];

  const usage: AgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    steps: 0,
  };

  let intentRetries = 0;
  let planRetries = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive is the only on-mode on Sonnet 5; `budget_tokens` is rejected.
      thinking: { type: 'adaptive' },
      output_config: { effort: AGENT_EFFORT },
      /*
       * One cache breakpoint, on the system block. The API renders
       * tools -> system -> messages, so a breakpoint here covers the tool
       * schemas *and* the prompt — the whole stable prefix, ~7k tokens —
       * while the conversation sits outside it and varies freely.
       *
       * An hour, not the default five minutes. The prefix is identical for
       * every user, so under steady traffic it never goes cold either way; but
       * with gaps between messages, a five-minute entry expires and the next
       * message re-writes the whole prefix — most of what a message costs. The
       * one-hour write costs 2x instead of 1.25x and pays for itself on the
       * third message in the hour.
       */
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      tools: TOOLS,
      messages,
      /*
       * And one on the conversation: the SDK marks the last block, so each step
       * of a tool loop reads everything up to the previous step from cache
       * rather than paying full input price for the whole history again.
       */
      cache_control: { type: 'ephemeral' },
    });

    accumulate(usage, response.usage);
    usage.steps += 1;

    const text = textOf(response);
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      return { kind: 'reply', text, usage };
    }

    /* --- A proposal that plans ends the turn -------------------------------- */

    const proposal = toolUses.find((use) => use.name === PROPOSE_INTENT);

    if (proposal) {
      const parsed = parseIntent(unwrapIntentInput(proposal.input));
      let refusal: string;

      if (parsed.ok) {
        if (!plan) return { kind: 'intent', intent: parsed.intent, plan: null, text, usage };

        const outcome = await plan(parsed.intent);
        if (outcome.ok) return { kind: 'intent', intent: parsed.intent, plan: outcome.plan, text, usage };

        planRetries += 1;
        if (planRetries > MAX_PLAN_RETRIES) {
          return { kind: 'cannot_plan', reason: outcome.message, text, usage };
        }

        // Nothing was shown to the user yet, so the model gets to answer
        // knowing the outcome: fix the proposal, or say why it can't be done.
        refusal =
          `The planner could not build this: ${outcome.message}\n\n` +
          `Nothing was shown to the user, including your text so far. If you got something wrong — the chain, ` +
          `the token, the amount — check with a tool and call ${PROPOSE_INTENT} again. If it cannot be done, ` +
          `tell the user why in your own words, and what they can do instead.`;
      } else {
        intentRetries += 1;
        if (intentRetries > MAX_INTENT_RETRIES) {
          return { kind: 'invalid_intent', error: parsed.error, issues: parsed.issues, text, usage };
        }

        // Hand the errors back and let it try again. Never repair it ourselves.
        refusal = `${parsed.error}\n\nFix these and call ${PROPOSE_INTENT} again. Do not guess at a value you are unsure of — ask the user instead.`;
      }

      // Every tool call in a message needs its result in the next one — the
      // read-only ones called alongside the proposal included.
      const others = toolUses.filter((use) => use !== proposal);
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: proposal.id, is_error: true, content: refusal },
          ...(await runTools(others, tools)),
        ],
      });

      continue;
    }

    /* --- Every other tool: execute all, answer in one message ------------- */

    // All results in a single user message. Splitting them across several
    // teaches the model to stop making parallel calls.
    messages.push({ role: 'user', content: await runTools(toolUses, tools) });
  }

  return { kind: 'exhausted', text: '', usage };
}

/** Run read-only tool calls in parallel. A failing tool is reported to the model, never thrown. */
function runTools(uses: Anthropic.ToolUseBlock[], tools: AgentTools): Promise<Anthropic.ToolResultBlockParam[]> {
  return Promise.all(
    uses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
      try {
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(untrustedJson(await callTool(use.name, use.input, tools))),
        };
      } catch (error) {
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: error instanceof Error ? error.message : 'Tool failed',
        };
      }
    }),
  );
}

/** The shape a tool call's arguments are expected to have, checked before use. */
function stringArg(input: unknown, name: string): string {
  const value = (input as Record<string, unknown> | null)?.[name];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected a non-empty string for "${name}".`);
  }

  return value;
}

async function callTool(name: string, input: unknown, tools: AgentTools): Promise<unknown> {
  switch (name) {
    case 'get_balance':
      return tools.getBalance();
    case 'get_policy':
      return tools.getPolicy();
    case 'get_supported_chains':
      return tools.getSupportedChains();
    case 'list_contacts':
      return tools.listContacts();
    case 'get_token_price':
      return tools.getTokenPrice(stringArg(input, 'symbol'));
    case 'resolve_address':
      return tools.resolveAddress(stringArg(input, 'input'));
    case 'save_contact':
      return tools.saveContact(stringArg(input, 'label'), stringArg(input, 'address'));
    case 'delete_contact':
      return tools.deleteContact(stringArg(input, 'label'));
    case 'get_recent_activity':
      return tools.getRecentActivity();
    case 'get_arc_ecosystem':
      return tools.getArcEcosystem();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function accumulate(total: AgentUsage, usage: Anthropic.Usage): void {
  total.inputTokens += usage.input_tokens;
  total.outputTokens += usage.output_tokens;
  total.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
  total.cacheWrite1hTokens += usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
}

/**
 * What a turn cost, in USD, at Claude Sonnet 5's list prices — for logs and
 * dashboards, not billing. Thinking is billed as output, so it is inside
 * `outputTokens`. Update these if `AGENT_MODEL` changes.
 */
const PRICE_PER_MTOK = {
  input: 2,
  output: 10,
  cacheRead: 0.2,
  cacheWrite5m: 2.5,
  cacheWrite1h: 4,
} as const;

export function estimateCostUsd(usage: AgentUsage): number {
  const write5m = usage.cacheWriteTokens - usage.cacheWrite1hTokens;

  return (
    (usage.inputTokens * PRICE_PER_MTOK.input +
      usage.outputTokens * PRICE_PER_MTOK.output +
      usage.cacheReadTokens * PRICE_PER_MTOK.cacheRead +
      write5m * PRICE_PER_MTOK.cacheWrite5m +
      usage.cacheWrite1hTokens * PRICE_PER_MTOK.cacheWrite1h) /
    1_000_000
  );
}
