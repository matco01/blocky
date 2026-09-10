import { serve } from '@hono/node-server';
import { AddressSchema, PolicySchema } from '@blocky/shared';
import {
  CHAINS,
  DEFAULT_CHAIN,
  createChainReader,
  deriveSessionPermissions,
  getChain,
  isSessionExpired,
  rpcConfigFromEnv,
} from '@blocky/wallet-core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { createAgentHandler } from './agent';
import { loadEnv } from './env';
import { createMemoryStore } from './store';

const env = loadEnv();
const store = createMemoryStore();

const reader = createChainReader(rpcConfigFromEnv(env));

/** Null until an Anthropic key is configured; the route 503s rather than the process refusing to boot. */
const agent = env.ANTHROPIC_API_KEY
  ? createAgentHandler(store, env.ANTHROPIC_API_KEY, reader)
  : null;

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

/**
 * Agent chat.
 *
 * The read path runs end to end: message → intent → plan → policy decision.
 * Nothing signs. Even an `auto_execute` decision comes back for the client to
 * act on, because session keys land in M4.
 */
const ChatBodySchema = z.object({
  // Bounded because it is billed input, and because an unbounded user string is
  // the cheapest denial-of-wallet attack there is.
  message: z.string().min(1).max(2000),
});

app.post('/v1/agent/chat', async (c) => {
  if (!agent) {
    return c.json({ error: 'Agent is not configured — set ANTHROPIC_API_KEY' }, 503);
  }

  const parsed = ChatBodySchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
  }

  return c.json(await agent(c.get('userId'), parsed.data.message));
});

/**
 * Session keys.
 *
 * Minting derives on-chain permissions from the policy the user actually set —
 * `deriveSessionPermissions` may only ever narrow it — and the result is what
 * would be installed in the Kernel validator.
 *
 * ⚠️  The installation itself is not built. Without it these permissions are
 * enforced server-side only, which is the weaker half of the guarantee: it
 * stops mistakes, not a compromised server. Needs ZERODEV_PROJECT_ID and the
 * user's device signature.
 */
app.get('/v1/session', async (c) => {
  const session = await store.activeSession(c.get('userId'), DEFAULT_CHAIN);

  if (!session) return c.json({ active: false, session: null });

  return c.json({
    active: true,
    session: {
      id: session.id,
      chainId: session.permissions.chainId,
      validUntil: session.permissions.validUntil,
      calls: session.permissions.calls,
      spendLimits: session.permissions.spendLimits.map((limit) => ({
        token: limit.token,
        limit: limit.limit.toString(),
      })),
    },
    onChain: false,
    note: 'Enforced server-side only — the on-chain validator is not installed yet.',
  });
});

app.post('/v1/session', async (c) => {
  const userId = c.get('userId');
  const policy = await store.getPolicy(userId);

  if (!policy.enabled) {
    return c.json({ error: 'Turn on agent autonomy in settings before minting a session.' }, 400);
  }

  // The agent's key. Generated and held server-side by design — it is bounded
  // by the permissions below, not by secrecy. A real one arrives in M4 proper.
  const signerAddress = '0x00000000000000000000000000000000000000a9' as const;

  const permissions = deriveSessionPermissions({
    policy,
    chainId: DEFAULT_CHAIN,
    signerAddress,
  });

  const session = {
    id: crypto.randomUUID(),
    permissions,
    createdAt: new Date(),
    revokedAt: null,
  };

  await store.putSession(userId, session);

  return c.json(
    {
      id: session.id,
      validUntil: permissions.validUntil,
      expired: isSessionExpired(permissions),
      onChain: false,
      note: 'Server-side only. Not installed on-chain, so nothing can actually sign yet.',
    },
    201,
  );
});

/**
 * The revoke switch.
 *
 * Deliberately unconditional and deliberately boring: no confirmation, no
 * parameters, no partial revocation. The one operation a frightened user
 * performs must not have options.
 */
app.delete('/v1/session', async (c) => {
  const revoked = await store.revokeSessions(c.get('userId'));

  return c.json({ revoked });
});

/**
 * Contacts.
 *
 * The only free-text handle the agent may use for a destination, and safe for
 * exactly that reason: a label resolves against this list or it fails. The
 * model cannot invent one that happens to work.
 */
const ContactSchema = z.object({
  label: z.string().min(1).max(64),
  address: AddressSchema,
});

app.get('/v1/contacts', async (c) => c.json(await store.listContacts(c.get('userId'))));

app.post('/v1/contacts', async (c) => {
  const parsed = ContactSchema.safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return c.json({ error: 'Invalid contact', issues: parsed.error.issues }, 400);
  }

  await store.saveContact(c.get('userId'), parsed.data.label, parsed.data.address);

  /*
   * Saving a contact does NOT allowlist them for unattended sends. Those are
   * separate on purpose: "I know who this is" and "the agent may pay them
   * without asking me" are different statements, and conflating them would let
   * a convenience action quietly widen the agent's authority.
   */
  return c.json(parsed.data, 201);
});

app.delete('/v1/contacts/:label', async (c) => {
  const removed = await store.deleteContact(c.get('userId'), c.req.param('label'));

  return removed ? c.json({ ok: true }) : c.json({ error: 'No such contact' }, 404);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`blocky api on http://localhost:${port} (${env.NODE_ENV})`);
});

export type AppType = typeof app;
export { app };
