import { buildPlan, encodeErc20Transfer } from '@blocky/planner';
import {
  AddressSchema,
  AmountSpecSchema,
  BridgeIntentSchema,
  ChainIdSchema,
  PolicySchema,
  RecipientRefSchema,
  TransferIntentSchema,
  evaluatePolicy,
  formatUsd,
  parseUsd,
  planOutflowUsd,
  type Address,
  type ChainId,
  type Plan,
} from '@blocky/shared';
import {
  DEFAULT_CHAIN,
  NATIVE_TOKEN,
  acrossPeriphery,
  acrossSpokePool,
  cctpContracts,
  containsAcrossDeposit,
  gasZipDepositContract,
  groupCalls,
  isExactTransaction,
  supportsBatching,
  chainsOnNetwork,
  containsCctpBurn,
  containsTransfer,
  deriveSessionPermissions,
  getChain,
  isSessionExpired,
  type ChainReader,
  type GatewayBalances,
  type TokenHolding,
  type TrackedToken,
  readUsdcBalance,
  stockByAddress,
} from '@blocky/wallet-core';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { mergeActivity, type ExplorerTransfer } from './activity';
import type { AgentResponse, ChatTurn } from './agent';
import { authenticate, type AuthenticatedUser, type IdentityProvider } from './auth';
import { createPlannerContext, type BlockyFeeTerms } from './planner-context';
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
  /** Holdings on other chains: gas tokens, and USDC moved there — never throws; a dead chain reports nothing found. */
  walletHoldings: (address: Address, tracked: readonly TrackedToken[]) => Promise<TokenHolding[]>;
  /** Drop a wallet's cached holdings, so the next read is fresh. */
  forgetHoldings?: (address: Address) => void;
  explorerTransfers: (address: Address) => Promise<ExplorerTransfer[]>;
  /** How long to wait for a just-submitted transaction to become visible. */
  receiptPolling?: { attempts: number; delayMs: number };
  logRequests?: boolean;
  /** Blocky's fee on swaps and moves out of Arc; absent means none. */
  blockyFee?: BlockyFeeTerms | null;
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
      chains: chainsOnNetwork().map((chain) => ({
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

    /*
     * The recipient allowlist is server-owned: it only grows when a verified
     * send lands (see the executions route). Whatever the client sends is
     * ignored, so a stale Limits screen can't wipe it, and a client can't
     * declare a stranger "already sent to".
     */
    const userId = c.get('user').id;
    const { recipientAllowlist } = await store.getPolicy(userId);
    const policy = { ...parsed.data, recipientAllowlist };

    await store.setPolicy(userId, policy);
    return c.json(policy);
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
   * `otherHoldings` is what sits on other chains: their gas token, and USDC
   * that was moved there. Not spendable through a plan either, and never on
   * the critical path: a failed read degrades to an empty list, same as
   * Gateway. Stablecoins among them count as cash in the history, the rest as
   * investments.
   */
  app.get('/v1/balance', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const chain = getChain(DEFAULT_CHAIN);

    const [spendable, gateway, otherHoldings] = await Promise.allSettled([
      readUsdcBalance(reader, chain.id, wallet),
      deps.gatewayBalances(wallet),
      store.listTrackedTokens(c.get('user').id).then((tracked) => deps.walletHoldings(wallet, tracked)),
    ]);

    if (spendable.status === 'rejected') {
      return c.json({ error: 'balance_unavailable', message: 'Balance is temporarily unavailable.' }, 503);
    }

    const { amount, usd: display } = spendable.value;
    const gatewayValue = gateway.status === 'fulfilled' ? gateway.value : null;
    const holdings = otherHoldings.status === 'fulfilled' ? otherHoldings.value : [];

    // Best-effort history: a throttled snapshot off a real read, never a
    // reason for the balance response itself to fail.
    const valueOf = (stable: boolean) =>
      holdings.reduce((sum, h) => sum + (h.stable === stable && h.usd ? parseUsd(h.usd) : 0n), 0n);
    const spendableUsd = amount + parseUsd(gatewayValue?.totalUsd ?? '0') + valueOf(true);
    const investmentsUsd = valueOf(false);
    void store
      .recordBalanceSnapshot(c.get('user').id, {
        spendableUsd: formatUsd(spendableUsd),
        investmentsUsd: formatUsd(investmentsUsd),
      })
      .catch(() => {});

    return c.json({
      chainId: chain.id,
      totalUsd: display,
      /**
       * Everything the wallet holds, in dollars: Arc USDC, Gateway deposits,
       * and every priced holding on other chains. The headline number on
       * Home. `totalUsd` stays the Arc-only figure a send can spend.
       */
      portfolioUsd: formatUsd(spendableUsd + investmentsUsd),
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
    /**
     * What to send, and from which chain — as the asset picker names it.
     * Omitted: USDC on Arc. Resolved by the planner like any symbol the agent
     * names, so nothing here can point it at an arbitrary contract.
     */
    asset: z.object({ symbol: z.string().min(1).max(20), chainId: ChainIdSchema }).optional(),
  });

  app.post('/v1/plans', async (c) => {
    const wallet = walletOf(c);
    if (wallet instanceof Response) return wallet;

    const parsed = ManualSendSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid send', issues: parsed.error.issues }, 400);
    }

    const { asset } = parsed.data;
    const intent = TransferIntentSchema.parse({
      type: 'transfer',
      token: { kind: 'symbol', symbol: asset?.symbol ?? 'USDC' },
      amount: parsed.data.amount,
      recipient: parsed.data.recipient,
      ...(asset ? { chainId: asset.chainId } : {}),
      rationale: 'Sent manually from the Send screen.',
    });

    const userId = c.get('user').id;
    const outcome = await buildPlan(intent, createPlannerContext({ reader, store, userId, account: wallet, blockyFee: deps.blockyFee ?? null }));

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
    const shape = planShape(plan);

    if (!shape) {
      return c.json({ error: 'unsupported_plan', message: 'That plan cannot be re-quoted.' }, 422);
    }

    const rationale = plan.modelRationale || 'Re-quoted.';
    // The same amount the user already saw, in exact token units — never
    // re-derived from dollars at a new price.
    const amount = { kind: 'token' as const, value: shape.outflow.displayAmount };

    const intent =
      shape.kind !== 'transfer'
        ? BridgeIntentSchema.parse({
            type: 'bridge',
            // USDC, or the gas token being sold to come home.
            token: { kind: 'symbol', symbol: shape.outflow.token.address === NATIVE_TOKEN ? shape.outflow.token.symbol : 'USDC' },
            amount,
            fromChainId: shape.chainId,
            toChainId: shape.destination,
            // The same thing arriving, and the same gas top-up, as the quote
            // being refreshed.
            ...(plan.inflow[0]?.token.address === NATIVE_TOKEN
              ? { receive: { kind: 'symbol', symbol: plan.inflow[0].token.symbol } }
              : {}),
            ...(plan.route?.gasTopUp ? { includeGas: true } : {}),
            rationale,
          })
        : TransferIntentSchema.parse({
            type: 'transfer',
            // A verified token is re-resolved by symbol; an address would come
            // back "unverified" and pick up a danger warning it never had.
            token: shape.outflow.token.verified
              ? { kind: 'symbol', symbol: shape.outflow.token.symbol }
              : { kind: 'address', address: shape.outflow.token.address, chainId: shape.outflow.token.chainId },
            amount,
            // A contact keeps its label on the card. Anything else is pinned to
            // the exact address the user already saw, never re-resolved from a
            // name.
            recipient: shape.recipient.contactLabel
              ? { kind: 'contact', label: shape.recipient.contactLabel }
              : { kind: 'address', address: shape.recipient.address },
            chainId: shape.call.chainId,
            rationale,
          });

    const outcome = await buildPlan(intent, createPlannerContext({ reader, store, userId, account: wallet, blockyFee: deps.blockyFee ?? null }));
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

  /**
   * One hash per transaction the plan goes out as, in order (see
   * `groupCalls`) — usually one; more when a gas top-up rides along, or on a
   * chain where approve and deposit can't be batched.
   * `txHash` alone is the older, single-transaction form.
   */
  const ExecutionBodySchema = z
    .object({ txHash: TxHashSchema.optional(), txHashes: z.array(TxHashSchema).min(1).max(4).optional() })
    .refine((body) => body.txHash || body.txHashes, 'A transaction hash is required.');

  /**
   * "I signed and submitted plan X; here is the transaction."
   *
   * Not taken on trust. The receipt must contain exactly what the plan
   * describes — for a send, the token contract, sender, recipient and amount;
   * for a move between chains, the burn's amount, fee ceiling, destination and
   * that it mints to the user's own address — or it is not an execution of
   * this plan and nothing is recorded. Otherwise any hash could be attached to
   * any plan.
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
    const shape = planShape(plan);

    if (!shape) {
      return c.json({ error: 'unsupported_plan', message: 'That plan cannot be verified.' }, 422);
    }

    const chainId = shape.kind === 'transfer' ? shape.call.chainId : shape.chainId;
    const hashes = (parsed.data.txHashes ?? [parsed.data.txHash!]).map((hash) => hash.toLowerCase() as `0x${string}`);
    const groups = groupCalls(plan.calls);

    // Every transaction that moves the money is required; only a trailing gas
    // top-up may be missing, and is then recorded as not sent.
    const required = groups.length - (plan.route?.gasTopUp ? 1 : 0);

    if (hashes.length > groups.length) {
      return c.json({ error: 'mismatch', message: 'More transactions than that plan makes.' }, 422);
    }
    if (hashes.length < required) {
      return c.json({ error: 'incomplete', message: 'Not every transaction of that plan was sent.' }, 422);
    }

    // Every transaction reported must be exactly its part of the plan.
    for (const [index, hash] of hashes.entries()) {
      const group = groups[index]!;
      const receipt = await pollReceipt(() => reader.transactionReceipt(group[0]!.chainId, hash), polling);

      if (!receipt) {
        return c.json(
          { status: 'unconfirmed', message: "That transaction isn't visible on-chain yet. Try again shortly." },
          202,
        );
      }

      // A send of a chain's own token (ETH on Arbitrum) leaves no Transfer log
      // to read: it is checked as the exact transaction instead.
      const exactly = index > 0 || shape.kind === 'exact' || (shape.kind === 'transfer' && BigInt(shape.call.value) > 0n);
      const matches =
        exactly
          ? isExactTransaction(receipt.transaction, receipt.status, { from: wallet, calls: group })
          : shape.kind === 'transfer'
            ? containsTransfer(receipt, {
                token: shape.call.to,
                from: wallet,
                to: shape.recipient.address,
                amount: BigInt(shape.outflow.amount),
              })
            : shape.kind === 'cctp'
              ? containsCctpBurn(receipt, {
                  messenger: shape.messenger,
                  burnToken: shape.token,
                  depositor: wallet,
                  amount: shape.input,
                  // Only ever the user's own wallet: a burn minting to anyone
                  // else is not the move they approved.
                  mintRecipient: wallet,
                  destinationDomain: shape.destinationDomain,
                  maxFee: shape.maxFee,
                })
              : containsAcrossDeposit(receipt, {
                  spokePool: shape.spokePool,
                  inputToken: shape.token,
                  outputToken: shape.outputToken,
                  inputAmount: shape.input,
                  outputAmount: shape.output,
                  destinationChainId: shape.destination,
                  depositor: wallet,
                  // The same rule: paying out to anyone but the user is not this plan.
                  recipient: wallet,
                });

      // Checked by its events, the move doesn't prove the fee rode along in
      // the same batch. A client that drops it has not sent this plan.
      const feeHere = shape.kind !== 'transfer' && shape.blockyFee && group.includes(shape.blockyFee.call) ? shape.blockyFee : null;
      const feePaid =
        exactly ||
        !feeHere ||
        containsTransfer(receipt, { token: feeHere.token, from: wallet, to: feeHere.recipient, amount: feeHere.amount });

      if (!matches || !feePaid) {
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
    }

    // The transaction that actually moves the money: the last required one
    // that isn't Blocky's fee going on its own.
    const feeCall = shape.kind === 'transfer' ? null : shape.blockyFee?.call;
    let moneyIndex = required - 1;
    while (moneyIndex > 0 && groups[moneyIndex]!.length === 1 && groups[moneyIndex]![0] === feeCall) moneyIndex -= 1;
    const txHash = hashes[moneyIndex]!;
    const incomplete = hashes.length < groups.length;

    try {
      const execution = await store.recordExecution(userId, {
        planId: plan.id,
        origin,
        chainId,
        txHash,
        // For a move between chains, the contract the USDC went to on-chain —
        // the same counterparty the explorer reports for it.
        counterparty: shape.kind === 'transfer' ? shape.recipient.address : shape.counterparty,
        amount: shape.outflow.displayAmount,
        /*
         * USDC is always priced. An unpriced plan cannot auto-execute (the
         * policy engine requires a human for it), and falling back to the fee
         * alone understates spend only for tokens we do not support yet.
         */
        outflowUsd: planOutflowUsd(plan) ?? plan.fee.totalUsd,
        summary: incomplete ? `${plan.summary} The gas top-up was not sent.` : plan.summary,
      });

      // Verified against the receipt above, so it settles immediately.
      await store.settleExecution(execution.id, 'success');

      // A token bought by contract — no list knows it — is remembered, so the
      // portfolio keeps showing it. Best effort: the purchase stands either way.
      const bought = plan.intentType === 'bridge' ? plan.inflow[0]?.token : undefined;
      if (bought && !bought.verified) {
        await store
          .trackToken(userId, { chainId: bought.chainId, address: bought.address, symbol: bought.symbol, decimals: bought.decimals })
          .catch((error: unknown) => console.error('trackToken failed', error));
      }

      // Money just moved: the next balance read should see it, not a cached
      // scan from before.
      deps.forgetHoldings?.(wallet);

      /*
       * A recipient becomes "known" only here: after a send the user approved
       * with their own fingerprint has landed on-chain. That is what the
       * one-tap path in Limits means by "people you have already sent to".
       * Best effort — the transfer happened either way, and failing the
       * request now would have the app retry into a 409.
       */
      if (shape.kind === 'transfer') {
        await store.addKnownRecipient(userId, shape.recipient.address).catch((error: unknown) => {
          console.error('addKnownRecipient failed', error);
        });
      }

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
 * The plan shapes the planner builds, taken apart. Every route that has to
 * read a stored plan asks here, so they can't drift into accepting different
 * shapes — and anything that isn't exactly one of these is refused.
 */
type PlanShape =
  | {
      kind: 'transfer';
      call: Plan['calls'][number];
      outflow: Plan['outflow'][number];
      recipient: NonNullable<Plan['recipient']>;
    }
  | (BridgeShape &
      (
        | {
            kind: 'cctp';
            destinationDomain: number;
            token: Address;
            /** What leaves, exactly as approved and burned. */
            input: bigint;
            maxFee: bigint;
            messenger: Address;
          }
        | {
            kind: 'across';
            token: Address;
            outputToken: Address;
            input: bigint;
            /** Exactly what the relayer pays out, as quoted and deposited. */
            output: bigint;
            spokePool: Address;
          }
        /** A swap or a Gas.zip deposit: verified as the exact transaction, byte for byte. */
        | { kind: 'exact' }
      ));

interface BridgeShape {
  chainId: ChainId;
  outflow: Plan['outflow'][number];
  destination: ChainId;
  /** The contract the money went to on-chain — what the explorer reports as the counterparty. */
  counterparty: Address;
  /** Blocky's fee transfer, when the plan charges one: it must land exactly as planned. */
  blockyFee: { call: Plan['calls'][number]; token: Address; recipient: Address; amount: bigint } | null;
}

/**
 * Blocky's fee in a plan: exactly one USDC transfer on Arc, of exactly the
 * planned amount, to exactly the planned address — set aside, so the move
 * reads as it always has. `undefined` for a plan that charges none; null for
 * one whose fee is not what it says, which is refused.
 */
function blockyFeeOf(plan: Plan): BridgeShape['blockyFee'] | undefined {
  if (!plan.blockyFee) return undefined;

  const amount = BigInt(plan.blockyFee.amount);
  const data = encodeErc20Transfer(plan.blockyFee.recipient, amount);
  const matching = plan.calls.filter((call) => call.data === data);
  const call = matching[0];

  if (matching.length !== 1 || !call || call.value !== '0' || !supportsBatching(call.chainId)) return null;
  if (call.to !== getChain(call.chainId).usdc) return null;

  return { call, token: call.to, recipient: plan.blockyFee.recipient, amount };
}

function planShape(plan: Plan): PlanShape | null {
  const [outflow] = plan.outflow;
  if (!outflow) return null;

  if (plan.intentType === 'transfer') {
    const [call] = plan.calls;
    if (plan.calls.length !== 1 || !call || !plan.recipient) return null;
    return { kind: 'transfer', call, outflow, recipient: plan.recipient };
  }

  if (plan.intentType !== 'bridge' || plan.recipient !== null) return null;

  const fee = blockyFeeOf(plan);
  if (fee === null) return null;
  const blockyFee = fee ?? null;
  const calls = blockyFee ? plan.calls.filter((call) => call !== blockyFee.call) : plan.calls;

  const [inflow] = plan.inflow;
  const groups = groupCalls(calls);
  const main = groups[0];
  if (!inflow || !main || main.length === 0) return null;

  const chainId = main[0]!.chainId;

  // From another chain there is no batching: every call is its own
  // transaction, each verified byte for byte — and each may only touch a
  // contract we pinned, or approve the source chain's USDC to one.
  if (!supportsBatching(chainId)) {
    const pinned = new Set(
      [acrossSpokePool(chainId), acrossPeriphery(chainId), cctpContracts(chainId)?.tokenMessenger].filter(
        (address): address is Address => Boolean(address),
      ),
    );
    // Blocky charges nothing from other chains; a fee here is not a plan we made.
    if (blockyFee) return null;
    // What may be approved before the last call: that chain's USDC, or the
    // token this plan sells. The approval itself is verified byte for byte.
    const usdc = getChain(chainId).usdc;
    const approvable = (to: Address) => to === usdc || to === outflow.token.address || stockByAddress(chainId, to) !== null;
    const last = plan.calls[plan.calls.length - 1]!;
    const allowed = plan.calls.every(
      (call) => call.chainId === chainId && (pinned.has(call.to) || (approvable(call.to) && call !== last)),
    );
    if (!allowed || !pinned.has(last.to)) return null;

    return { chainId, outflow, destination: inflow.token.chainId, kind: 'exact', counterparty: last.to, blockyFee };
  }

  // Anything after the main transaction may only be a Gas.zip top-up.
  const gasZip = gasZipDepositContract(chainId);
  if (groups.slice(1).some((group) => group.length !== 1 || group[0]!.to !== gasZip)) return null;

  const base = { chainId, outflow, destination: inflow.token.chainId, blockyFee };
  // What the bridge is given: what leaves, less Blocky's fee.
  const input = BigInt(outflow.amount) - (blockyFee?.amount ?? 0n);

  // Which road it takes is read off the contract it calls — and only a
  // contract we pinned ourselves counts.
  if (main.length === 1) {
    return main[0]!.to === gasZip ? { ...base, kind: 'exact', counterparty: gasZip } : null;
  }

  const [approve, deposit] = main;
  if (main.length !== 2 || !approve || !deposit) return null;

  const cctp = cctpContracts(chainId);
  if (cctp && deposit.to === cctp.tokenMessenger) {
    const destinationDomain = getChain(inflow.token.chainId).circleDomain;
    if (destinationDomain === null) return null;

    return {
      ...base,
      kind: 'cctp',
      counterparty: cctp.tokenMinter,
      destinationDomain,
      token: approve.to,
      input,
      // What leaves less what is promised to land: the ceiling Circle may take.
      maxFee: input - BigInt(inflow.amount),
      messenger: cctp.tokenMessenger,
    };
  }

  const spokePool = acrossSpokePool(chainId);
  if (spokePool && deposit.to === spokePool) {
    // A swap deposit carries Across's instructions for the destination; it is
    // checked as the exact transaction the user approved.
    if (plan.route?.provider === 'across-swap') return { ...base, kind: 'exact', counterparty: spokePool };

    return {
      ...base,
      kind: 'across',
      counterparty: spokePool,
      token: approve.to,
      outputToken: inflow.token.address,
      input,
      output: BigInt(inflow.amount),
      spokePool,
    };
  }

  return null;
}
