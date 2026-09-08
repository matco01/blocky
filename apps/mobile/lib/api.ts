import { PolicySchema, type Policy } from '@blocky/shared';
import { z } from 'zod';

/**
 * Typed API client.
 *
 * Responses are parsed with the shared schemas rather than cast. The server is
 * ours, but "ours" includes a version of it deployed three weeks ago that a
 * user hasn't updated past — validating at the boundary turns that into a clear
 * error instead of a screen rendering `undefined`.
 */

/**
 * Where the API lives.
 *
 * `localhost` only works in a simulator. On a physical device — which you need
 * from M0, since passkeys don't work properly in the iOS simulator — set
 * EXPO_PUBLIC_API_URL to your machine's LAN address, e.g. http://192.168.1.20:8787
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

const BalanceSchema = z.object({
  totalUsd: z.string(),
  usdc: z.object({
    amount: z.string(),
    displayAmount: z.string(),
    usdValue: z.string(),
  }),
  perChain: z.array(
    z.object({
      chainId: z.number(),
      amount: z.string(),
      usdValue: z.string(),
    }),
  ),
});

export type Balance = z.infer<typeof BalanceSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * ⚠️  M0 placeholder auth. The Privy access token replaces this header in M1,
 * before any route can move money.
 */
let userId = 'dev-user';

export function setUserId(id: string) {
  userId = id;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-blocky-user': userId,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(`${init?.method ?? 'GET'} ${path} failed`, response.status);
  }

  const parsed = schema.safeParse(await response.json());

  if (!parsed.success) {
    throw new ApiError(`Unexpected response shape from ${path}`, response.status);
  }

  return parsed.data;
}

export const api = {
  health: () => request('/health', z.object({ ok: z.boolean(), defaultChain: z.string() })),

  balance: () => request('/v1/balance', BalanceSchema),

  getPolicy: () => request('/v1/policy', PolicySchema),

  setPolicy: (policy: Policy) =>
    request('/v1/policy', PolicySchema, { method: 'PUT', body: JSON.stringify(policy) }),
};
