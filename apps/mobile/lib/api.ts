import {
  PlanSchema,
  PolicyDecisionSchema,
  PolicySchema,
  type AmountSpec,
  type Plan,
  type Policy,
  type RecipientRef,
} from '@blocky/shared';
import { z } from 'zod';
import { config } from './config';

/**
 * Typed API client.
 *
 * Responses are parsed with schemas rather than cast. The server is ours, but
 * "ours" includes a version deployed three weeks ago that the user hasn't
 * updated past — validating at the boundary turns that into a clear error
 * instead of a screen rendering `undefined` next to a dollar sign.
 */

/* -------------------------------------------------------------------------- */
/*  Auth                                                                       */
/* -------------------------------------------------------------------------- */

type TokenGetter = () => Promise<string | null>;

let getToken: TokenGetter = async () => null;

/** Wired to Privy's `getAccessToken` by the root layout once Privy is ready. */
export function setTokenGetter(getter: TokenGetter) {
  getToken = getter;
}

/* -------------------------------------------------------------------------- */
/*  Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const BalanceSchema = z.object({
  chainId: z.number(),
  /** Arc USDC only: what a send can spend. */
  totalUsd: z.string(),
  /** Everything the wallet holds, on every chain. Absent from older servers. */
  portfolioUsd: z.string().optional(),
  usdc: z.object({ amount: z.string(), displayAmount: z.string() }),
  gateway: z
    .object({
      totalUsd: z.string(),
      perChain: z.array(z.object({ chainId: z.number(), balanceUsd: z.string() })),
    })
    .nullable(),
  /** What sits on other chains: their gas token, and USDC moved there. Not spendable through a plan. */
  otherHoldings: z.array(
    z.object({
      chainId: z.number(),
      symbol: z.string(),
      amount: z.string(),
      decimals: z.number(),
      usd: z.string().nullable(),
      /** A dollar stablecoin — shown with cash, not investments. Absent from older servers. */
      stable: z.boolean().default(false),
    }),
  ),
});

const BalanceHistorySchema = z.object({
  snapshots: z.array(z.object({ spendableUsd: z.string(), investmentsUsd: z.string(), takenAt: z.string() })),
});

const ActivityItemSchema = z.object({
  id: z.string(),
  direction: z.enum(['sent', 'received']),
  txHash: z.string(),
  counterparty: z.string(),
  amount: z.string(),
  status: z.enum(['pending', 'success', 'reverted']),
  /** Set where "Sent to 0x…" would mislead, e.g. a move to another chain. Absent from older servers. */
  title: z.string().nullable().default(null),
  summary: z.string().nullable(),
  timestamp: z.string(),
});

const ActivitySchema = z.object({
  items: z.array(ActivityItemSchema),
  complete: z.boolean(),
});

const ExecutionSchema = z.object({
  execution: z.object({ id: z.string(), txHash: z.string(), status: z.string() }),
});

const AgentResponseSchema = z.object({
  kind: z.enum(['reply', 'intent', 'invalid_intent', 'exhausted', 'plan', 'cannot_plan']),
  reply: z.string(),
  plan: PlanSchema.nullable(),
  decision: PolicyDecisionSchema.nullable(),
  /** Every plan in the reply. Older servers send only `plan`. */
  plans: z.array(z.object({ plan: PlanSchema, decision: PolicyDecisionSchema })).default([]),
  status: z.string(),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

/** A prior chat turn, as the server expects it. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type Balance = z.infer<typeof BalanceSchema>;
export type BalanceHistory = z.infer<typeof BalanceHistorySchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

/* -------------------------------------------------------------------------- */
/*  Transport                                                                  */
/* -------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Machine-readable code from the server, e.g. `insufficient_balance`. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const token = await getToken();

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Can't reach Blocky right now. Check your connection.", 0);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const { message, error } = (body ?? {}) as { message?: string; error?: string };
    throw new ApiError(message ?? 'Something went wrong.', response.status, error ?? null);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('Blocky sent a response this version of the app does not understand.', response.status);
  }

  return parsed.data;
}

/* -------------------------------------------------------------------------- */
/*  Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

export const api = {
  balance: () => request('/v1/balance', BalanceSchema),

  balanceHistory: () => request('/v1/balance/history', BalanceHistorySchema),

  activity: () => request('/v1/activity', ActivitySchema),

  getPolicy: () => request('/v1/policy', PolicySchema),

  setPolicy: (policy: Policy) =>
    request('/v1/policy', PolicySchema, { method: 'PUT', body: JSON.stringify(policy) }),

  /** Ask the server to plan a send. It resolves, prices and checks it; nothing is signed. */
  planSend: (recipient: RecipientRef, amount: AmountSpec) =>
    request('/v1/plans', z.object({ plan: PlanSchema }), {
      method: 'POST',
      body: JSON.stringify({ recipient, amount }),
    }).then((r): Plan => r.plan),

  /** Talk to the agent. History is the recent conversation, oldest first. */
  agentChat: (message: string, history: readonly ChatTurn[]) =>
    request('/v1/agent/chat', AgentResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),

  /** A fresh quote for a plan whose price window has passed. Keeps the plan's origin. */
  requotePlan: (planId: string) =>
    request(`/v1/plans/${planId}/requote`, z.object({ plan: PlanSchema }), { method: 'POST' }).then(
      (r): Plan => r.plan,
    ),

  /**
   * Report a plan's transactions, in order. The server verifies each receipt
   * against its part of the plan before recording anything; a 202 means "not
   * visible yet, ask again".
   */
  reportExecution: async (planId: string, txHashes: readonly string[]) => {
    const token = await getToken();
    const response = await fetch(`${config.apiUrl}/v1/plans/${planId}/executions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ txHashes }),
    });

    if (response.status === 202) return { confirmed: false as const };

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const { message, error } = (body ?? {}) as { message?: string; error?: string };
      throw new ApiError(message ?? 'Could not confirm that transaction.', response.status, error ?? null);
    }

    return { confirmed: true as const, execution: ExecutionSchema.parse(body).execution };
  },
};
