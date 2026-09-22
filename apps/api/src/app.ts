import { buildPlan } from '@blocky/planner';
import {
  AddressSchema,
  AmountSpecSchema,
  PolicySchema,
  RecipientRefSchema,
  TransferIntentSchema,
  evaluatePolicy,
  formatUsd,
  parseUsd,
  planOutflowUsd,
  type Address,
  type Plan,
} from '@blocky/shared';
import {
  CHAINS,
  DEFAULT_CHAIN,
  containsTransfer,
  deriveSessionPermissions,
  getChain,
  isSessionExpired,
  type ChainReader,
  type GatewayBalances,
  type TokenHolding,
  readUsdcBalance,
} from '@blocky/wallet-core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { mergeActivity, type ExplorerTransfer } from './activity';
import type { AgentResponse, ChatTurn } from './agent';
import { authenticate, type AuthenticatedUser, type IdentityProvider } from './auth';
import { createPlannerContext } from './planner-context';
import { DuplicateExecutionError, type Store } from './store';

export interface AppDeps {
  store: Store;
  reader: ChainReader;
  identity: IdentityProvider;
  /** Null when no Anthropic key is configured; the chat route 503s. */
  agent:
    | ((
        user: { id: string; walletAddress: Address },
        message: string,
        history: readonly ChatTurn[],
      ) => Promise<AgentResponse>)
    | null;
  gatewayBalances: (address: Address) => Promise<GatewayBalances>;
  /** Native-currency holdings on other chains — never throws; a dead chain reports nothing found. */
  walletHoldings: (address: Address) => Promise<TokenHolding[]>;
  explorerTransfers: (address: Address) => Promise<ExplorerTransfer[]>;
  /** How long to wait for a just-submitted transaction to become visible. */
  receiptPolling?: { attempts: number; delayMs: number };
  logRequests?: boolean;
}

type Vars = { user: AuthenticatedUser };
type Ctx = Context<{ Variables: Vars }>;

const TxHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 32-byte transaction hash');

export function createApp(deps: AppDeps) {
  const { store, reader, identity } = deps;
  const polling = deps.receiptPolling ?? { attempts: 20, delayMs: 500 };

  const app = new Hono<{ Variables: Vars }>();

  if (deps.logRequests) app.use('*', logger());
  app.use('*', cors({ origin: '*' }));

  /**
   * Authentication: a verified Privy access token, nothing else. The old
   * development header that trusted a user id outright is gone.
   */
  app.use('/v1/*', async (c, next) => {
    const user = await authenticate(c.req.header('authorization'), identity, store);

    if (!user) {
      return c.json({ error: 'Missing or invalid access token' }, 401);
    }

    c.set('user', user);
    await next();
  });

  /** The wallet, or a response explaining why there is not one yet. */
  function walletOf(c: Ctx): Address | Response {
    const wallet = c.get('user').walletAddress;

    return (
      wallet ??
      c.json({ error: 'wallet_not_ready', message: 'Your wallet is still being created.' }, 409)
    );
  }

  app.get('/health', (c) => c.json({ ok: true, defaultChain: getChain(DEFAULT_CHAIN).name }));

  app.get('/v1/me', (c) => {
    const user = c.get('user');
    return c.json({ userId: user.id, walletAddress: user.walletAddress, chainId: DEFAULT_CHAIN });
  });

  /** The chains the API knows about, for a client that doesn't bundle `@blocky/wallet-core`. */
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

  app.get('/v1/policy', async (c) => c.json(await store.getPolicy(c.get('user').id)));

  app.put('/v1/policy', async (c) => {
    const parsed = PolicySchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return c.json({ error: 'Invalid policy', issues: parsed.error.issues }, 400);
    }

    await store.setPolicy(c.get('user').id, parsed.data);
    return c.json(parsed.data);
  });

  /* ------------------------------------------------------------------------ */
  /*  Balance                                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * The balance.
   *
   * `totalUsd` is what the user can spend right now: USDC in their wallet on
   * the home chain, read through the 6-decimal ERC-20 interface. On Arc the
   * same money is also visible as an 18-decimal native balance; it is never
   * added in, because that would double it.
   *
   * Gateway deposits are reported separately and not included, because no plan
   * can spend them yet. A failed Gateway read degrades to `gateway: null`; a
   * failed wallet read is a 503 — never a zero, which would read as "your
   * money is gone".
   *
   * `otherHoldings` is native currency on other chains — ETH sitting on Base
   * Sepolia, say. Not spendable through a plan either, and never on the
   * critical path: a failed read degrades to an empty list, same as Gateway.
   */
  app.get('/v1/balance', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const chain = getChain(DEFAULT_CHAIN);

    const [spendable, gateway, otherHoldings] = await Promise.allSettled([
      readUsdcBalance(reader, chain.id, wallet),
      deps.gatewayBalances(wallet),
      deps.walletHoldings(wallet),
    ]);

    if (spendable.status === 'rejected') {
      return c.json({ error: 'balance_unavailable', message: 'Balance is temporarily unavailable.' }, 503);
    }

    const { amount, usd: display } = spendable.value;
    const gatewayValue = gateway.status === 'fulfilled' ? gateway.value : null;
    const holdings = otherHoldings.status === 'fulfilled' ? otherHoldings.value : [];

    // Best-effort history: a throttled snapshot off a real read, never a
    // reason for the balance response itself to fail.
    const spendableUsd = amount + parseUsd(gatewayValue?.totalUsd ?? '0');
    const investmentsUsd = holdings.reduce((sum, h) => sum + (h.usd ? parseUsd(h.usd) : 0n), 0n);
    void store
      .recordBalanceSnapshot(c.get('user').id, {
        spendableUsd: formatUsd(spendableUsd),
        investmentsUsd: formatUsd(investmentsUsd),
      })
      .catch(() => {});

    return c.json({
      chainId: chain.id,
      totalUsd: display,
      usdc: { amount: amount.toString(), displayAmount: display },
      gateway: gatewayValue,
      otherHoldings: holdings,
    });
  });

  /**
   * Balance history, split the same way the portfolio screen is. Only ever
   * what `/v1/balance` has actually recorded — no backfill, no interpolation
   * between two real points.
   */
  app.get('/v1/balance/history', async (c) => {
    const days = 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const snapshots = await store.listBalanceSnapshots(c.get('user').id, since);

    return c.json({ snapshots });
  });

  /* ------------------------------------------------------------------------ */
  /*  Activity                                                                 */
  /* ------------------------------------------------------------------------ */

  app.get('/v1/activity', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const [executions, transfers] = await Promise.all([
      store.listExecutions(c.get('user').id),
      deps.explorerTransfers(wallet).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
    ]);

    return c.json({
      items: mergeActivity(wallet, executions, transfers.ok ? transfers.value : []),
      // When the explorer is down the feed still shows our own sends, and says
      // it is partial rather than implying nothing was received.
      complete: transfers.ok,
    });
  });

  /* ------------------------------------------------------------------------ */
  /*  Plans and execution                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * A manual send, from the Send screen.
   *
   * Goes through exactly the same planner as the agent — same resolution, same
   * warnings, same fee reserve — so the two paths cannot disagree about what a
   * send costs or whether it is possible. The only difference is the origin:
   * manual sends are not counted against the agent's daily cap.
   */
  const ManualSendSchema = z.object({
    recipient: RecipientRefSchema,
    amount: AmountSpecSchema,
  });

  app.post('/v1/plans', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const parsed = ManualSendSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid send', issues: parsed.error.issues }, 400);
    }

    const intent = TransferIntentSchema.parse({
      type: 'transfer',
      token: { kind: 'symbol', symbol: 'USDC' },
      amount: parsed.data.amount,
      recipient: parsed.data.recipient,
      rationale: 'Sent manually from the Send screen.',
    });

    const userId = c.get('user').id;
    const outcome = await buildPlan(intent, createPlannerContext({ reader, store, userId, account: wallet }));

    if (!outcome.ok) {
      return c.json({ error: outcome.failure.code, message: outcome.failure.message }, 422);
    }

    await store.putPlan(userId, outcome.plan, 'manual');
    return c.json({ plan: outcome.plan }, 201);
  });

  /**
   * A fresh quote for a plan whose price window has passed.
   *
   * Rebuilt from the stored plan rather than from anything the app sends, and
   * stored with the *same origin*. That matters: if an expired agent plan came
   * back as a manual one, the agent's spend would slip out of its daily cap
   * simply by the user reading the chat slowly. Agent plans are also re-judged
   * by the policy engine, since the cap may have filled up in the meantime.
   */
  app.post('/v1/plans/:id/requote', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const userId = c.get('user').id;
    const stored = await store.getPlan(userId, c.req.param('id'));
    if (!stored) return c.json({ error: 'No such plan' }, 404);

    const { plan, origin } = stored;
    const transfer = singleTransfer(plan);

    if (!transfer) {
      return c.json({ error: 'unsupported_plan', message: 'Only single transfers can be re-quoted.' }, 422);
    }

    const { call, outflow, recipient } = transfer;

    const intent = TransferIntentSchema.parse({
      type: 'transfer',
      // A verified token is re-resolved by symbol; an address would come back
      // "unverified" and pick up a danger warning it never had.
      token: outflow.token.verified
        ? { kind: 'symbol', symbol: outflow.token.symbol }
        : { kind: 'address', address: outflow.token.address, chainId: outflow.token.chainId },
      amount: { kind: 'token', value: outflow.displayAmount },
      // A contact keeps its label on the card. Anything else is pinned to the
      // exact address the user already saw, never re-resolved from a name.
      recipient: recipient.contactLabel
        ? { kind: 'contact', label: recipient.contactLabel }
        : { kind: 'address', address: recipient.address },
      chainId: call.chainId,
      rationale: plan.modelRationale || 'Re-quoted.',
    });

    const outcome = await buildPlan(intent, createPlannerContext({ reader, store, userId, account: wallet }));
    if (!outcome.ok) {
      return c.json({ error: outcome.failure.code, message: outcome.failure.message }, 422);
    }

    if (origin === 'agent') {
      const [policy, spentTodayUsd] = await Promise.all([store.getPolicy(userId), store.spentTodayUsd(userId)]);
      const decision = evaluatePolicy({ policy, plan: outcome.plan, spentTodayUsd });

      if (decision.outcome === 'deny') {
        return c.json(
          { error: 'denied', message: decision.reasons.map((reason) => reason.message).join(' ') },
          422,
        );
      }
    }

    await store.putPlan(userId, outcome.plan, origin);
    return c.json({ plan: outcome.plan }, 201);
  });

  const ExecutionBodySchema = z.object({ txHash: TxHashSchema });

  /**
   * "I signed and submitted plan X; here is the transaction."
   *
   * Not taken on trust. The receipt must contain exactly the transfer the plan
   * describes — token contract, sender, recipient, amount — or it is not an
   * execution of this plan and nothing is recorded. Otherwise any hash could be
   * attached to any plan.
   */
  app.post('/v1/plans/:id/executions', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const parsed = ExecutionBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid execution', issues: parsed.error.issues }, 400);
    }

    const userId = c.get('user').id;
    const stored = await store.getPlan(userId, c.req.param('id'));
    if (!stored) return c.json({ error: 'No such plan' }, 404);

    const { plan, origin } = stored;
    const transfer = singleTransfer(plan);

    if (!transfer) {
      return c.json({ error: 'unsupported_plan', message: 'Only single transfers can be verified.' }, 422);
    }

    const { call, outflow, recipient } = transfer;

    const txHash = parsed.data.txHash.toLowerCase() as `0x${string}`;
    const receipt = await pollReceipt(() => reader.transactionReceipt(call.chainId, txHash), polling);

    if (!receipt) {
      return c.json(
        { status: 'unconfirmed', message: "That transaction isn't visible on-chain yet. Try again shortly." },
        202,
      );
    }

    const matches = containsTransfer(receipt, {
      token: call.to,
      from: wallet,
      to: recipient.address,
      amount: BigInt(outflow.amount),
    });

    if (!matches) {
      return c.json(
        {
          error: 'mismatch',
          message:
            receipt.status === 'reverted'
              ? 'That transaction failed on-chain. Nothing was sent.'
              : "That transaction didn't make this transfer.",
        },
        422,
      );
    }

    try {
      const execution = await store.recordExecution(userId, {
        planId: plan.id,
        origin,
        chainId: call.chainId,
        txHash,
        counterparty: recipient.address,
        amount: outflow.displayAmount,
        /*
         * USDC is always priced. An unpriced plan cannot auto-execute (the
         * policy engine requires a human for it), and falling back to the fee
         * alone understates spend only for tokens we do not support yet.
         */
        outflowUsd: planOutflowUsd(plan) ?? plan.fee.totalUsd,
        summary: plan.summary,
      });

      // Verified against the receipt above, so it settles immediately.
      await store.settleExecution(execution.id, 'success');

      return c.json({ execution: { ...execution, status: 'success' } }, 201);
    } catch (error) {
      if (error instanceof DuplicateExecutionError) {
        return c.json({ error: 'already_executed', message: error.message }, 409);
      }
      throw error;
    }
  });

  /* ------------------------------------------------------------------------ */
  /*  Agent                                                                    */
  /* ------------------------------------------------------------------------ */

  const ChatBodySchema = z.object({
    // Bounded because it is billed input, and because an unbounded user string is
    // the cheapest denial-of-wallet attack there is.
    message: z.string().min(1).max(2000),
    /** Recent turns, oldest first. Same reasoning: capped in count and length. */
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(4000),
        }),
      )
      .max(20)
      .default([]),
  });

  app.post('/v1/agent/chat', async (c) => {
    if (!deps.agent) {
      return c.json({ error: 'Agent is not configured — set ANTHROPIC_API_KEY' }, 503);
    }

    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const parsed = ChatBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    }

    // A conversation must open with the user. Anything before the first user
    // turn is dropped rather than rejected — it is the app's trimming, not an
    // attack, when the oldest message in the window happens to be a reply.
    const firstUser = parsed.data.history.findIndex((turn) => turn.role === 'user');
    const history = firstUser === -1 ? [] : parsed.data.history.slice(firstUser);

    return c.json(
      await deps.agent({ id: c.get('user').id, walletAddress: wallet }, parsed.data.message, history),
    );
  });

  /* ------------------------------------------------------------------------ */
  /*  Session keys                                                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Minting derives on-chain permissions from the policy the user actually set —
   * `deriveSessionPermissions` may only ever narrow it — and the result is what
   * would be installed in the Kernel validator.
   *
   * ⚠️  The installation itself is not built. Without it these permissions are
   * enforced server-side only, which is the weaker half of the guarantee: it
   * stops mistakes, not a compromised server.
   */
  app.get('/v1/session', async (c) => {
    const session = await store.activeSession(c.get('user').id, DEFAULT_CHAIN);

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
    const userId = c.get('user').id;
    const policy = await store.getPolicy(userId);

    if (!policy.enabled) {
      return c.json({ error: 'Turn on agent autonomy in settings before minting a session.' }, 400);
    }

    // The agent's key. Generated and held server-side by design — it is bounded
    // by the permissions below, not by secrecy. A real one arrives with the
    // on-chain validator.
    const signerAddress = '0x00000000000000000000000000000000000000a9' as const;

    const permissions = deriveSessionPermissions({ policy, chainId: DEFAULT_CHAIN, signerAddress });

    const session = { id: crypto.randomUUID(), permissions, createdAt: new Date(), revokedAt: null };
    await store.putSession(userId, session);

    return c.json(
      {
        id: session.id,
        validUntil: permissions.validUntil,
        expired: isSessionExpired(permissions),
        onChain: false,
        note: 'Server-side only. Not installed on-chain, so nothing can sign unattended yet.',
      },
      201,
    );
  });

  /**
   * The revoke switch. Deliberately unconditional and deliberately boring: no
   * confirmation, no parameters, no partial revocation. The one operation a
   * frightened user performs must not have options.
   */
  app.delete('/v1/session', async (c) => c.json({ revoked: await store.revokeSessions(c.get('user').id) }));

  /* ------------------------------------------------------------------------ */
  /*  Contacts                                                                 */
  /* ------------------------------------------------------------------------ */

  const ContactSchema = z.object({ label: z.string().min(1).max(64), address: AddressSchema });

  app.get('/v1/contacts', async (c) => c.json(await store.listContacts(c.get('user').id)));

  app.post('/v1/contacts', async (c) => {
    const parsed = ContactSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return c.json({ error: 'Invalid contact', issues: parsed.error.issues }, 400);
    }

    await store.saveContact(c.get('user').id, parsed.data.label, parsed.data.address);

    /*
     * Saving a contact does NOT allowlist them for unattended sends. "I know who
     * this is" and "the agent may pay them without asking me" are different
     * statements, and conflating them would let a convenience action quietly
     * widen the agent's authority.
     */
    return c.json(parsed.data, 201);
  });

  app.delete('/v1/contacts/:label', async (c) => {
    const removed = await store.deleteContact(c.get('user').id, c.req.param('label'));
    return removed ? c.json({ ok: true }) : c.json({ error: 'No such contact' }, 404);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}

/**
 * Wait briefly for a just-submitted transaction to become visible. Arc
 * finalises in under a second; this covers the node catching up, not
 * confirmations — Arc has no reorgs to wait out.
 */
async function pollReceipt<T>(
  read: () => Promise<T | null>,
  { attempts, delayMs }: { attempts: number; delayMs: number },
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await read();
    if (result) return result;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/**
 * The only plan shape the planner builds today: one transfer, one call, one
 * recipient. Every route that has to take a stored plan apart asks here, so
 * they can't drift into accepting different shapes.
 */
function singleTransfer(plan: Plan) {
  const [call] = plan.calls;
  const [outflow] = plan.outflow;
  if (plan.intentType !== 'transfer' || plan.calls.length !== 1 || !call || !outflow || !plan.recipient) return null;
  return { call, outflow, recipient: plan.recipient };
}
