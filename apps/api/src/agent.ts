import Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, type AgentTools, type AgentTurn } from '@blocky/agent';
import { buildPlan } from '@blocky/planner';
import {
  evaluatePolicy,
  formatUnits,
  type Address,
  type Plan,
  type PolicyDecision,
} from '@blocky/shared';
import { CHAINS, DEFAULT_CHAIN, getChain, type ChainReader } from '@blocky/wallet-core';
import { createPlannerContext } from './planner-context';
import type { Store } from './store';

/**
 * The agent route's plumbing.
 *
 * The full read path is wired now: message → intent → plan → policy decision.
 * What is still missing is the last step — nothing signs, so even an
 * `auto_execute` decision comes back as something the client must act on. The
 * response says which, rather than implying a capability that does not exist.
 */

/** The dev wallet, until Privy supplies a real one in M1. */
const DEV_ACCOUNT = '0x0000000000000000000000000000000000000001' as const;

/**
 * Read-only tools, bound to one user.
 *
 * Constructed per request and closed over a single `userId`, so there is no
 * argument the model could supply that would read somebody else's data — the
 * tools take no arguments at all.
 */
export function agentToolsFor(
  store: Store,
  userId: string,
  reader: ChainReader,
  account: Address,
): AgentTools {
  return {
    /**
     * Read from the same chain the planner reads.
     *
     * These two disagreeing is worse than either being wrong alone: the agent
     * talks the user out of a transfer the planner would have built, or promises
     * one it then refuses. Circle Gateway's unified balance replaces this in M1;
     * until then it is a single-chain read rather than a placeholder zero.
     */
    async getBalance() {
      const chainId = DEFAULT_CHAIN;
      const usdc = getChain(chainId).usdc;

      try {
        const amount = await reader.erc20Balance(chainId, usdc, account);
        const display = formatUnits(amount, 6);

        return {
          totalUsd: display,
          usdc: { amount: amount.toString(), displayAmount: display, usdValue: display },
        };
      } catch {
        // Say we could not read it. A zero here reads as "you have no money",
        // which is a different and much more actionable claim.
        return { error: 'Balance is temporarily unavailable.' };
      }
    },

    async getPolicy() {
      return store.getPolicy(userId);
    },

    async getSupportedChains() {
      return Object.values(CHAINS).map((chain) => ({
        name: chain.name,
        testnet: chain.testnet,
      }));
    },

    async listContacts() {
      return store.listContacts(userId);
    },
  };
}

export interface AgentResponse {
  kind: AgentTurn['kind'] | 'plan' | 'cannot_plan';
  reply: string;
  /** The planner's output. Proposed, priced and checked — but not signed. */
  plan: Plan | null;
  /** What the policy engine says should happen to it. */
  decision: PolicyDecision | null;
  /** Plain-language note about what has and has not happened. */
  status: string;
  usage: AgentTurn['usage'];
}

export function createAgentHandler(store: Store, apiKey: string, reader: ChainReader) {
  // One client for the process. Constructing per request throws away the
  // connection pool for no benefit.
  const client = new Anthropic({ apiKey });

  return async function handle(userId: string, message: string): Promise<AgentResponse> {
    const turn = await runAgentTurn(message, {
      client,
      tools: agentToolsFor(store, userId, reader, DEV_ACCOUNT),
    });

    const empty = { plan: null, decision: null, usage: turn.usage };

    switch (turn.kind) {
      case 'reply':
        return { ...empty, kind: turn.kind, reply: turn.text, status: 'ok' };

      case 'invalid_intent':
        return {
          ...empty,
          kind: turn.kind,
          reply: turn.text,
          status: `The agent could not produce a valid intent: ${turn.error}`,
        };

      case 'exhausted':
        return {
          ...empty,
          kind: turn.kind,
          reply: turn.text,
          status: 'The agent used its step budget without reaching an answer.',
        };

      case 'intent':
        break;
    }

    /* --- An intent was proposed. Plan it, then judge it. ------------------- */

    const outcome = await buildPlan(
      turn.intent,
      createPlannerContext({ reader, store, userId, account: DEV_ACCOUNT }),
    );

    if (!outcome.ok) {
      return {
        ...empty,
        kind: 'cannot_plan',
        reply: turn.text,
        status: outcome.failure.message,
      };
    }

    const decision = evaluatePolicy({
      policy: await store.getPolicy(userId),
      plan: outcome.plan,
      spentTodayUsd: await store.spentTodayUsd(userId),
    });

    // Held so the client can approve it by id rather than posting a plan back —
    // a plan that arrives from a client is a plan an attacker can edit.
    await store.putPlan(userId, outcome.plan);

    return {
      kind: 'plan',
      reply: turn.text,
      plan: outcome.plan,
      decision,
      status: statusFor(decision),
      usage: turn.usage,
    };
  };
}

function statusFor(decision: PolicyDecision): string {
  switch (decision.outcome) {
    case 'deny':
      return `Blocked by your settings: ${decision.reasons.map((r) => r.message).join(' ')}`;
    case 'require_confirmation':
      return 'Needs your approval. Nothing is signed or sent yet — signing lands in M4.';
    case 'auto_execute':
      return 'Within your limits, but nothing can sign it yet — session keys land in M4.';
  }
}
