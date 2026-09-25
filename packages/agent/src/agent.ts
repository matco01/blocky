import Anthropic from '@anthropic-ai/sdk';
import { parseIntent, type Intent } from '@blocky/shared';
import { SYSTEM_PROMPT } from './system-prompt';
import { PROPOSE_INTENT, TOOLS, untrustedJson, unwrapIntentInput } from './tools';

/**
 * The agent loop.
 *
 * Written by hand rather than with the SDK's tool runner, for one reason:
 * `propose_intent` is *terminal*. When the model calls it the turn is over and
 * control returns to the policy engine — there is no tool result to feed back,
 * because whether the thing happens is not the model's decision to observe. A
 * runner that loops until the model stops wanting tools has the wrong shape for
 * that, and bending it into the right shape costs more than the loop below.
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

export type AgentTurn =
  /** The agent answered. Nothing is proposed. */
  | { kind: 'reply'; text: string; usage: AgentUsage }
  /** A valid intent. Hand it to the planner. Nothing has executed. */
  | { kind: 'intent'; intent: Intent; text: string; usage: AgentUsage }
  /** The model could not produce a well-formed intent. Do not repair it — surface it. */
  | { kind: 'invalid_intent'; error: string; issues: string[]; text: string; usage: AgentUsage }
  /** The loop ran out of steps. */
  | { kind: 'exhausted'; text: string; usage: AgentUsage };

export interface AgentOptions {
  client: Anthropic;
  tools: AgentTools;
  /** Prior turns. The API is stateless, so the caller owns the history. */
  history?: Anthropic.MessageParam[];
}

/* -------------------------------------------------------------------------- */
/*  Loop                                                                       */
/* -------------------------------------------------------------------------- */

export async function runAgentTurn(
  message: string,
  { client, tools, history = [] }: AgentOptions,
): Promise<AgentTurn> {
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

    /* --- A proposal ends the turn, whatever was called alongside it -------- */

    const proposal = toolUses.find((use) => use.name === PROPOSE_INTENT);

    if (proposal) {
      const parsed = parseIntent(unwrapIntentInput(proposal.input));

      if (parsed.ok) {
        return { kind: 'intent', intent: parsed.intent, text, usage };
      }

      intentRetries += 1;

      if (intentRetries > MAX_INTENT_RETRIES) {
        return { kind: 'invalid_intent', error: parsed.error, issues: parsed.issues, text, usage };
      }

      // Hand the errors back and let it try again. Never repair it ourselves.
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: proposal.id,
            is_error: true,
            content: `${parsed.error}\n\nFix these and call ${PROPOSE_INTENT} again. Do not guess at a value you are unsure of — ask the user instead.`,
          },
        ],
      });

      continue;
    }

    /* --- Every other tool: execute all, answer in one message ------------- */

    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
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

    // All results in a single user message. Splitting them across several
    // teaches the model to stop making parallel calls.
    messages.push({ role: 'user', content: results });
  }

  return { kind: 'exhausted', text: '', usage };
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
