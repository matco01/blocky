import { serve } from '@hono/node-server';
import { PolicySchema } from '@blocky/shared';
import { CHAINS, DEFAULT_CHAIN, getChain } from '@blocky/wallet-core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { loadEnv } from './env';
import { createMemoryStore } from './store';

const env = loadEnv();
const store = createMemoryStore();

/**
 * Authenticated user id, from the Privy access token the app sends.
 *
 * ⚠️  M0 placeholder: this trusts the header outright. Real verification
 * against Privy's JWKS lands with the wallet routes in M1 — before anything
 * here can move money. Kept obvious rather than clever so it cannot be
 * mistaken for the real thing.
 */
type Vars = { userId: string };

const app = new Hono<{ Variables: Vars }>();

app.use('*', logger());
app.use('*', cors({ origin: '*' }));

app.use('/v1/*', async (c, next) => {
  const userId = c.req.header('x-blocky-user');

  if (!userId) {
    return c.json({ error: 'Missing authentication' }, 401);
  }

  c.set('userId', userId);
  await next();
});

app.get('/health', (c) =>
  c.json({
    ok: true,
    env: env.NODE_ENV,
    defaultChain: getChain(DEFAULT_CHAIN).name,
  }),
);

/** Chains the app knows about, so the client never hardcodes a chain list. */
app.get('/v1/chains', (c) =>
  c.json({
    defaultChainId: DEFAULT_CHAIN,
    chains: Object.values(CHAINS).map((chain) => ({
      id: chain.id,
      name: chain.name,
      shortName: chain.shortName,
      testnet: chain.testnet,
      explorerUrl: chain.explorerUrl,
    })),
  }),
);

app.get('/v1/policy', async (c) => c.json(await store.getPolicy(c.get('userId'))));

app.put('/v1/policy', async (c) => {
  const parsed = PolicySchema.safeParse(await c.req.json());

  if (!parsed.success) {
    return c.json({ error: 'Invalid policy', issues: parsed.error.issues }, 400);
  }

  await store.setPolicy(c.get('userId'), parsed.data);
  return c.json(parsed.data);
});

/**
 * Balance.
 *
 * M0 returns a zeroed shape so the client can render the real Home screen
 * against the real contract. Circle Gateway's unified balance replaces the
 * body in M1; the shape does not change.
 */
app.get('/v1/balance', async (c) =>
  c.json({
    totalUsd: '0',
    usdc: { amount: '0', displayAmount: '0', usdValue: '0' },
    /** Gateway makes this chain-agnostic; present only for the detail view. */
    perChain: [],
  }),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`blocky api on http://localhost:${port} (${env.NODE_ENV})`);
});

export type AppType = typeof app;
export { app };
