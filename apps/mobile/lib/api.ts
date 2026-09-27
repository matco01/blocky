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
  /** Set aside in savings pots. Absent from older servers. */
  potsUsd: z.string().optional(),
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

const MeSchema = z.object({ userId: z.string(), walletAddress: z.string().nullable(), username: z.string().nullable().optional() });

const PaymentRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  requesterUsername: z.string().nullable(),
  requesterWallet: z.string(),
  payerId: z.string().nullable(),
  payerUsername: z.string().nullable(),
  amountUsd: z.string(),
  note: z.string().nullable(),
  status: z.enum(['open', 'paid', 'declined', 'cancelled']),
  fromStranger: z.boolean().default(false),
  createdAt: z.string(),
});

const NotificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.unknown(),
  read: z.boolean(),
  createdAt: z.string(),
});

const InsightsSchema = z.object({
  insights: z.object({
    month: z.string(),
    spentUsd: z.string(),
    byCategory: z.object({ people: z.string(), investing: z.string() }),
    feesUsd: z.string(),
    receivedUsd: z.string(),
    soldUsd: z.string(),
    topPeople: z.array(z.object({ name: z.string(), usd: z.string() })),
    lastMonthSpentUsd: z.string().nullable(),
    count: z.number(),
  }),
  budgets: z.array(z.object({ category: z.string(), monthlyUsd: z.string(), spentUsd: z.string() })),
});

const PotSchema = z.object({ id: z.string(), name: z.string(), targetUsd: z.string().nullable(), savedUsd: z.string(), createdAt: z.string() });

export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;
export type AppNotification = z.infer<typeof NotificationSchema>;
export type Insights = z.infer<typeof InsightsSchema>;
export type Pot = z.infer<typeof PotSchema>;

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

  me: () => request('/v1/me', MeSchema),

  /** Who goes by a name. A 404 (as an ApiError) means nobody — it's free. */
  lookupUser: (username: string) =>
    request(`/v1/users/${encodeURIComponent(username)}`, z.object({ username: z.string(), walletAddress: z.string() })),

  setUsername: (username: string) =>
    request('/v1/me/username', z.object({ username: z.string() }), { method: 'PUT', body: JSON.stringify({ username }) }),

  /* --- Requests ---------------------------------------------------------- */

  requests: () => request('/v1/requests', z.object({ incoming: z.array(PaymentRequestSchema), outgoing: z.array(PaymentRequestSchema) })),

  paymentRequest: (id: string) => request(`/v1/requests/${id}`, z.object({ request: PaymentRequestSchema })).then((r) => r.request),

  createRequest: (input: { payer?: string; amountUsd: string; note?: string }) =>
    request('/v1/requests', z.object({ request: PaymentRequestSchema, link: z.string(), shareText: z.string() }), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** A plan paying the request — approved on Send like any other. */
  payRequest: (id: string) =>
    request(`/v1/requests/${id}/pay`, z.object({ plan: PlanSchema }), { method: 'POST' }).then((r): Plan => r.plan),

  /** Block whoever made the request: declined, and no more from them. They aren't told. */
  blockRequester: (id: string) => request(`/v1/requests/${id}/block`, z.object({ blocked: z.boolean() }), { method: 'POST' }),

  declineRequest: (id: string) => request(`/v1/requests/${id}/decline`, z.object({ status: z.string() }), { method: 'POST' }),

  /* --- Notifications ----------------------------------------------------- */

  notifications: () => request('/v1/notifications', z.object({ items: z.array(NotificationSchema), unread: z.number() })),

  markNotificationsRead: () => request('/v1/notifications/read', z.object({ ok: z.boolean() }), { method: 'POST' }),

  /* --- Insights and pots ------------------------------------------------- */

  insights: (month?: string) => request(`/v1/insights${month ? `?month=${month}` : ''}`, InsightsSchema),

  setBudget: (category: 'people' | 'investing' | 'total', monthlyUsd: string | null) =>
    request('/v1/budgets', z.object({ budgets: z.array(z.object({ category: z.string(), monthlyUsd: z.string() })) }), {
      method: 'PUT',
      body: JSON.stringify({ category, monthlyUsd }),
    }),

  /** A month's statement as CSV text. */
  statement: async (month: string) => {
    const token = await getToken();
    const response = await fetch(`${config.apiUrl}/v1/statements/${month}.csv`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError('Could not make that statement.', response.status);
    return response.text();
  },

  pots: () => request('/v1/pots', z.object({ pots: z.array(PotSchema) })).then((r) => r.pots),

  createPot: (name: string, targetUsd: string | null) =>
    request('/v1/pots', z.object({ pot: PotSchema }), { method: 'POST', body: JSON.stringify({ name, targetUsd }) }).then((r) => r.pot),

  adjustPot: (id: string, deltaUsd: string) =>
    request(`/v1/pots/${id}/adjust`, z.object({ pot: PotSchema }), { method: 'POST', body: JSON.stringify({ deltaUsd }) }).then((r) => r.pot),

  deletePot: (id: string) => request(`/v1/pots/${id}`, z.object({ ok: z.boolean() }), { method: 'DELETE' }),

  balanceHistory: () => request('/v1/balance/history', BalanceHistorySchema),

  activity: () => request('/v1/activity', ActivitySchema),

  getPolicy: () => request('/v1/policy', PolicySchema),

  setPolicy: (policy: Policy) =>
    request('/v1/policy', PolicySchema, { method: 'PUT', body: JSON.stringify(policy) }),

  /** Ask the server to plan a send. It resolves, prices and checks it; nothing is signed. */
  /** A manual send. `asset` picks what and from which chain; omitted, it's USDC on Arc. */
  planSend: (recipient: RecipientRef, amount: AmountSpec, asset?: { symbol: string; chainId: number }) =>
    request('/v1/plans', z.object({ plan: PlanSchema }), {
      method: 'POST',
      body: JSON.stringify({ recipient, amount, ...(asset ? { asset } : {}) }),
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
