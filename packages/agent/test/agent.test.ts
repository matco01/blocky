import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { estimateCostUsd, runAgentTurn, type AgentTools } from '../src/agent';
import { PROPOSE_INTENT } from '../src/tools';

/**
 * Loop tests against a scripted client. No network, no spend.
 *
 * What is being pinned down here is control flow, and one rule above all: a
 * proposal ends the turn. The model does not get to observe whether its
 * proposal was accepted, because that decision is not its to make.
 */

function fakeClient(responses: Array<Partial<Anthropic.Message>>): {
  client: Anthropic;
  calls: Anthropic.MessageCreateParams[];
} {
  const calls: Anthropic.MessageCreateParams[] = [];
  let index = 0;

  const client = {
    messages: {
      create(params: Anthropic.MessageCreateParams) {
        // Snapshot the message array. The loop reuses and mutates one array —
        // harmless in production, since the SDK serialises immediately, but
        // recording it by reference would make every assertion below read the
        // final state instead of the state at call time.
        calls.push({ ...params, messages: [...params.messages] });

        const response = responses[index];
        index += 1;

        if (!response) throw new Error('Scripted client ran out of responses');

        return Promise.resolve({
          content: [],
          usage: { input_tokens: 10, output_tokens: 5 },
          ...response,
        } as Anthropic.Message);
      },
    },
  } as unknown as Anthropic;

  return { client, calls };
}

const tools: AgentTools = {
  getBalance: async () => ({ totalUsd: '100' }),
  getPolicy: async () => ({ enabled: false }),
  getSupportedChains: async () => [{ name: 'Base Sepolia', testnet: true }],
  listContacts: async () => [{ label: 'Sam', address: '0x3333333333333333333333333333333333333333' }],
  getTokenPrice: async (symbol) => ({ symbol, usd: 2628.32 }),
  resolveAddress: async (input) => ({ address: input, ensName: null }),
  saveContact: async (label, address) => ({ saved: true, label, address }),
  deleteContact: async (label) => ({ deleted: label === 'sam' }),
  getRecentActivity: async () => ({ items: [], complete: true }),
  getArcEcosystem: async () => ({ protocols: [] }),
};

const text = (value: string): Anthropic.TextBlock => ({
  type: 'text',
  text: value,
  citations: null,
});

const toolUse = (name: string, input: unknown, id = 'tu_1'): Anthropic.ToolUseBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
  caller: { type: 'direct' },
});

const VALID_TRANSFER = {
  type: 'transfer',
  token: { kind: 'symbol', symbol: 'USDC' },
  amount: { kind: 'usd', value: '20' },
  recipient: { kind: 'address', address: '0x1111111111111111111111111111111111111111' },
  rationale: 'Send $20 of USDC as asked.',
};

describe('plain replies', () => {
  it('returns text when the model calls no tools', async () => {
    const { client } = fakeClient([{ content: [text('Your balance is $100.')] }]);

    const turn = await runAgentTurn('what do I have?', { client, tools });

    expect(turn.kind).toBe('reply');
    expect(turn.text).toBe('Your balance is $100.');
    expect(turn.usage.steps).toBe(1);
  });
});

describe('read-only tools', () => {
  it('executes a tool and loops back for the answer', async () => {
    const { client, calls } = fakeClient([
      { content: [toolUse('get_balance', {})] },
      { content: [text('You have $100.')] },
    ]);

    const turn = await runAgentTurn('balance?', { client, tools });

    expect(turn.kind).toBe('reply');
    expect(turn.usage.steps).toBe(2);

    // The tool result went back fenced, not raw.
    const followUp = calls[1]?.messages.at(-1);
    expect(JSON.stringify(followUp)).toContain('untrusted-data');
  });

  it('returns every parallel tool result in a single user message', async () => {
    const { client, calls } = fakeClient([
      {
        content: [toolUse('get_balance', {}, 'a'), toolUse('get_policy', {}, 'b')],
      },
      { content: [text('done')] },
    ]);

    await runAgentTurn('status', { client, tools });

    const followUp = calls[1]?.messages.at(-1);
    expect(Array.isArray(followUp?.content)).toBe(true);
    expect(followUp?.content).toHaveLength(2);
  });

  it('passes the model\'s arguments through to the matching tool', async () => {
    let received: [string, string] | null = null;
    const withSpy: AgentTools = {
      ...tools,
      saveContact: async (label, address) => {
        received = [label, address];
        return { saved: true };
      },
    };

    const { client } = fakeClient([
      { content: [toolUse('save_contact', { label: 'Sam', address: '0x1111111111111111111111111111111111111111' })] },
      { content: [text('Saved.')] },
    ]);

    await runAgentTurn('save Sam', { client, tools: withSpy });

    expect(received).toEqual(['Sam', '0x1111111111111111111111111111111111111111']);
  });

  it('refuses a tool call missing its required argument, without touching the tool', async () => {
    let called = false;
    const withSpy: AgentTools = { ...tools, getTokenPrice: async (s) => { called = true; return { s }; } };

    const { client, calls } = fakeClient([
      { content: [toolUse('get_token_price', {})] },
      { content: [text('I need a symbol.')] },
    ]);

    await runAgentTurn('price?', { client, tools: withSpy });

    expect(called).toBe(false);
    expect(JSON.stringify(calls[1]?.messages.at(-1))).toContain('is_error');
  });

  it('reports a failing tool back to the model instead of throwing', async () => {
    const failing: AgentTools = {
      ...tools,
      getBalance: async () => {
        throw new Error('Gateway unreachable');
      },
    };

    const { client, calls } = fakeClient([
      { content: [toolUse('get_balance', {})] },
      { content: [text("I couldn't reach the network.")] },
    ]);

    const turn = await runAgentTurn('balance?', { client, tools: failing });

    expect(turn.kind).toBe('reply');
    expect(JSON.stringify(calls[1]?.messages.at(-1))).toContain('Gateway unreachable');
  });
});

describe('proposing an intent', () => {
  it('returns a validated intent and stops', async () => {
    const { client, calls } = fakeClient([
      { content: [text('Sending $20.'), toolUse(PROPOSE_INTENT, { intent: VALID_TRANSFER })] },
    ]);

    const turn = await runAgentTurn('send $20 to 0x1111...', { client, tools });

    expect(turn.kind).toBe('intent');
    expect(turn.usage.steps).toBe(1);
    // The turn ended. The model never learns what happened next.
    expect(calls).toHaveLength(1);
  });

  it('ends the turn even when a read-only tool was called alongside', async () => {
    const { client, calls } = fakeClient([
      {
        content: [
          toolUse('get_balance', {}, 'a'),
          toolUse(PROPOSE_INTENT, { intent: VALID_TRANSFER }, 'b'),
        ],
      },
    ]);

    const turn = await runAgentTurn('send it', { client, tools });

    expect(turn.kind).toBe('intent');
    expect(calls).toHaveLength(1);
  });

  it('hands validation errors back rather than repairing them', async () => {
    const truncated = {
      ...VALID_TRANSFER,
      recipient: { kind: 'address', address: '0x1111' },
    };

    const { client, calls } = fakeClient([
      { content: [toolUse(PROPOSE_INTENT, { intent: truncated })] },
      { content: [toolUse(PROPOSE_INTENT, { intent: VALID_TRANSFER })] },
    ]);

    const turn = await runAgentTurn('send it', { client, tools });

    expect(turn.kind).toBe('intent');

    const retry = JSON.stringify(calls[1]?.messages.at(-1));
    expect(retry).toContain('is_error');
    expect(retry).toContain('failed validation');
  });

  it('gives up rather than looping forever on a model that cannot get it right', async () => {
    const bad = { content: [toolUse(PROPOSE_INTENT, { intent: { type: 'nonsense' } })] };

    const { client } = fakeClient([bad, bad, bad]);

    const turn = await runAgentTurn('send it', { client, tools });

    expect(turn.kind).toBe('invalid_intent');
  });

  it('still validates an intent the model sent unwrapped', async () => {
    // The tools API forbids `oneOf` at the top level, so the union is nested
    // under `intent`. If a model ever sends it flat anyway, validate it rather
    // than failing on the envelope.
    const { client } = fakeClient([{ content: [toolUse(PROPOSE_INTENT, VALID_TRANSFER)] }]);

    const turn = await runAgentTurn('send it', { client, tools });

    expect(turn.kind).toBe('intent');
  });

  it('answers every tool call in the message when handing a proposal back', async () => {
    const { client, calls } = fakeClient([
      {
        content: [
          toolUse('get_balance', {}, 'a'),
          toolUse(PROPOSE_INTENT, { intent: { type: 'nonsense' } }, 'b'),
        ],
      },
      { content: [toolUse(PROPOSE_INTENT, { intent: VALID_TRANSFER })] },
    ]);

    await runAgentTurn('send it', { client, tools });

    // The API rejects a tool_use without its tool_result in the next message.
    const retry = JSON.stringify(calls[1]?.messages.at(-1));
    expect(retry).toContain('"tool_use_id":"a"');
    expect(retry).toContain('"tool_use_id":"b"');
  });

  it('never accepts smuggled calldata, even wrapped in a valid intent', async () => {
    const smuggled = { ...VALID_TRANSFER, calldata: '0xdeadbeef' };

    const { client } = fakeClient([{ content: [toolUse(PROPOSE_INTENT, { intent: smuggled })] }]);

    const turn = await runAgentTurn('send it', { client, tools });

    expect(turn.kind).toBe('intent');
    if (turn.kind === 'intent') {
      expect(turn.intent).not.toHaveProperty('calldata');
    }
  });
});

describe('cost controls', () => {
  it('caches the stable prefix on every request, for an hour', async () => {
    const { client, calls } = fakeClient([{ content: [text('hi')] }]);

    await runAgentTurn('hi', { client, tools });

    const system = calls[0]?.system;
    expect(Array.isArray(system)).toBe(true);
    // An hour: with gaps between messages a five-minute entry expires, and the
    // next message pays to re-write the whole ~7k-token prefix.
    expect((system as Anthropic.TextBlockParam[])[0]?.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('runs Sonnet 5 at low effort', async () => {
    const { client, calls } = fakeClient([{ content: [text('hi')] }]);

    await runAgentTurn('hi', { client, tools });

    expect(calls[0]?.model).toBe('claude-sonnet-5');
    expect(calls[0]?.output_config?.effort).toBe('low');
  });

  it('stops after a bounded number of steps', async () => {
    const loop = { content: [toolUse('get_balance', {})] };

    const { client, calls } = fakeClient(Array.from({ length: 10 }, () => loop));

    const turn = await runAgentTurn('loop forever', { client, tools });

    expect(turn.kind).toBe('exhausted');
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('accumulates usage across every billed step', async () => {
    const { client } = fakeClient([
      { content: [toolUse('get_balance', {})] },
      { content: [text('done')] },
    ]);

    const turn = await runAgentTurn('balance?', { client, tools });

    expect(turn.usage.inputTokens).toBe(20);
    expect(turn.usage.outputTokens).toBe(10);
  });
});

describe('estimateCostUsd', () => {
  it('prices each kind of token at its own Sonnet 5 rate', () => {
    // 1M of each: $2 in + $10 out + $0.20 cache read + $2.50 (5m write) + $4 (1h write).
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 2_000_000,
        cacheWrite1hTokens: 1_000_000,
        steps: 1,
      }),
    ).toBeCloseTo(18.7, 6);
  });
});

describe('planning inside the turn', () => {
  const WRONG_CHAIN = { type: 'bridge', token: { kind: 'symbol', symbol: 'ETH' }, amount: { kind: 'max' }, fromChainId: 42161, toChainId: 42161, rationale: 'Bring ETH home.' };
  const HOME = { ...WRONG_CHAIN, toChainId: 5042 };

  it('ends the turn with the plan when the planner builds it', async () => {
    const { client, calls } = fakeClient([{ content: [text('Here it is.'), toolUse(PROPOSE_INTENT, { intent: HOME })] }]);

    const turn = await runAgentTurn('bring my eth home', {
      client,
      tools,
      plan: async () => ({ ok: true, plan: 'the plan' }),
    });

    expect(turn.kind).toBe('intent');
    if (turn.kind === 'intent') expect(turn.plan).toBe('the plan');
    // A plan that builds costs nothing extra: no second model call.
    expect(calls).toHaveLength(1);
  });

  it('hands a refusal back so the model can fix its proposal', async () => {
    const { client, calls } = fakeClient([
      { content: [text("I'll propose it."), toolUse(PROPOSE_INTENT, { intent: WRONG_CHAIN })] },
      { content: [text('Here it is.'), toolUse(PROPOSE_INTENT, { intent: HOME })] },
    ]);

    const turn = await runAgentTurn('bring my eth home', {
      client,
      tools,
      plan: async (intent) =>
        intent.type === 'bridge' && intent.toChainId === 5042
          ? { ok: true, plan: 'home' }
          : { ok: false, message: 'That money is already on Arbitrum One.' },
    });

    expect(turn.kind).toBe('intent');
    // Only the final words reach the user — not the reply that preceded a refusal.
    expect(turn.text).toBe('Here it is.');
    const retry = JSON.stringify(calls[1]?.messages.at(-1));
    expect(retry).toContain('is_error');
    expect(retry).toContain('already on Arbitrum One');
  });

  it('lets the model explain a refusal in its own words', async () => {
    const { client } = fakeClient([
      { content: [toolUse(PROPOSE_INTENT, { intent: HOME })] },
      { content: [text("You don't have any ETH on Arbitrum right now.")] },
    ]);

    const turn = await runAgentTurn('bring my eth home', {
      client,
      tools,
      plan: async () => ({ ok: false, message: "You don't have any ETH on Arbitrum One." }),
    });

    expect(turn.kind).toBe('reply');
    expect(turn.text).toBe("You don't have any ETH on Arbitrum right now.");
  });

  it('gives up after a bounded number of refusals, keeping the reason', async () => {
    const again = { content: [toolUse(PROPOSE_INTENT, { intent: HOME })] };
    const { client, calls } = fakeClient([again, again, again, again]);

    const turn = await runAgentTurn('bring my eth home', {
      client,
      tools,
      plan: async () => ({ ok: false, message: 'No route.' }),
    });

    expect(turn.kind).toBe('cannot_plan');
    if (turn.kind === 'cannot_plan') expect(turn.reason).toBe('No route.');
    expect(calls).toHaveLength(3);
  });
});
