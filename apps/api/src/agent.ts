import Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, type AgentTools, type AgentTurn } from '@blocky/agent';
import { buildPlan } from '@blocky/planner';
import {
  AddressSchema,
  evaluatePolicy,
  formatUnits,
  type Address,
  type Plan,
  type PolicyDecision,
} from '@blocky/shared';
import {
  CHAINS,
  DEFAULT_CHAIN,
  getArcProtocols,
  getChain,
  getTokenPriceUsd,
  type ChainReader,
} from '@blocky/wallet-core';
import { mergeActivity, type ExplorerTransfer } from './activity';
import { createPlannerContext } from './planner-context';
import type { Store } from './store';

/**
 * The agent route's plumbing.
 *
 * message → intent → plan → policy decision, against the user's real wallet.
 * Signing happens on the device: the plan is stored, the app shows the card,
 * and the user approves with Face ID. Unattended execution needs the session
 * key's on-chain validator, which is not installed yet — so even an
 * `auto_execute` decision comes back for the user to approve, and the response
 * says so rather than implying a capability that does not exist.
 */

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
  explorerTransfers: (address: Address) => Promise<ExplorerTransfer[]>,
): AgentTools {
  return {
    /**
     * Read from the same chain the planner reads.
     *
     * These two disagreeing is worse than either being wrong alone: the agent
     * talks the user out of a transfer the planner would have built, or promises
     * one it then refuses. So this is the *spendable* Arc balance, the same
     * number the Home screen shows — not Gateway deposits, which no plan can
     * spend yet.
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

    async getTokenPrice(symbol) {
      try {
        const quote = await getTokenPriceUsd(symbol);
        return quote ?? { error: `No price available for ${symbol}.` };
      } catch {
        return { error: 'Price data is temporarily unavailable.' };
      }
    },

    /**
     * Preview an address or ENS name, for the agent to check before
     * `save_contact` — never an input to a transfer. Only the planner's own
     * resolution, inside `buildPlan`, is trusted for that.
     */
    async resolveAddress(input) {
      const trimmed = input.trim();

      const asAddress = AddressSchema.safeParse(trimmed);
      if (asAddress.success) {
        const ensName = await reader.lookupEns(asAddress.data).catch(() => null);
        return { address: asAddress.data, ensName };
      }

      if (!/^[^\s]{1,250}\.eth$/i.test(trimmed)) {
        return { error: 'Not a 0x address or an ENS name ending in .eth.' };
      }

      const address = await reader.resolveEns(trimmed.toLowerCase());
      if (!address) return { error: `Could not resolve ${trimmed}.` };

      return { address, ensName: trimmed.toLowerCase() };
    },

    async saveContact(label, address) {
      const parsed = AddressSchema.safeParse(address.trim());
      if (!parsed.success) {
        return { error: 'That is not a valid 0x address. Resolve it with resolve_address first.' };
      }

      await store.saveContact(userId, label, parsed.data);
      return { saved: true, label: label.trim(), address: parsed.data };
    },

    async deleteContact(label) {
      return { deleted: await store.deleteContact(userId, label) };
    },

    async getArcEcosystem() {
      try {
        return { protocols: await getArcProtocols() };
      } catch {
        return { error: 'Ecosystem data is temporarily unavailable.' };
      }
    },

    /**
     * Reuses the same merge the Activity screen renders, so the agent's answer
     * about the past can never disagree with what the user sees when they look.
     */
    async getRecentActivity() {
      const [executions, transfers] = await Promise.all([
        store.listExecutions(userId, 20),
        explorerTransfers(account).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const, value: [] as ExplorerTransfer[] }),
        ),
      ]);

      return {
        items: mergeActivity(account, executions, transfers.value).slice(0, 20),
        complete: transfers.ok,
      };
    },
  };
}

/**
 * A prior chat turn, as text.
 *
 * The API is stateless, so the app sends recent history with each message.
 * Text only — tool calls and their results are not replayed, because they must
 * arrive in matched pairs and a client-supplied tool result is a forged one.
 *
 * History is client-controlled, so a user can put words in the agent's mouth.
 * That only reaches their own session, and every action it could lead to
 * still goes through the planner, the policy engine and their own fingerprint.
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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

export function createAgentHandler(
  store: Store,
  apiKey: string,
  reader: ChainReader,
  explorerTransfers: (address: Address) => Promise<ExplorerTransfer[]>,
) {
  // One client for the process. Constructing per request throws away the
  // connection pool for no benefit.
  const client = new Anthropic({ apiKey });

  return async function handle(
    user: { id: string; walletAddress: Address },
    message: string,
    history: readonly ChatTurn[] = [],
  ): Promise<AgentResponse> {
    const userId = user.id;
    const account = user.walletAddress;

    const turn = await runAgentTurn(message, {
      client,
      tools: agentToolsFor(store, userId, reader, account, explorerTransfers),
      history: history.map((entry) => ({ role: entry.role, content: entry.content })),
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
      createPlannerContext({ reader, store, userId, account }),
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
    await store.putPlan(userId, outcome.plan, 'agent');

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
      return 'Needs your approval.';
    case 'auto_execute':
      return "Within your limits — but unattended sending needs the on-chain session key, which isn't installed yet, so this needs your approval too.";
  }
}
