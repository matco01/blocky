import {
  DEFAULT_POLICY,
  PolicySchema,
  formatUsd,
  parseUsd,
  type Address,
  type ChainId,
  type Plan,
  type Policy,
} from '@blocky/shared';
import type { SessionPermissions, TrackedToken } from '@blocky/wallet-core';
import { and, desc, eq, gte, inArray, isNull, gt, sql } from 'drizzle-orm';
import type { Db } from './db/client';
import {
  balanceSnapshots,
  blockedUsers,
  budgets,
  contacts,
  executions,
  memories,
  notifications,
  paymentRequests,
  plans,
  policies,
  pots,
  priceAlerts,
  sessions,
  trackedTokens,
  users,
} from './db/schema';

/**
 * Persistence, behind an interface.
 *
 * Postgres in production, embedded Postgres (PGlite) in development and tests.
 * There is one implementation: an in-memory stand-in would be a second copy of
 * every rule here, and the copy nobody runs in production is the one that
 * drifts.
 */

export type PlanOrigin = 'agent' | 'manual';
export type ExecutionStatus = 'pending' | 'success' | 'reverted';

export interface UserRecord {
  id: string;
  walletAddress: Address;
}

export interface StoredPlan {
  plan: Plan;
  origin: PlanOrigin;
}

export interface Execution {
  id: string;
  planId: string;
  origin: PlanOrigin;
  chainId: ChainId;
  txHash: string;
  status: ExecutionStatus;
  counterparty: Address;
  /** Transferred amount, excluding fees. */
  amount: string;
  /** Everything that left the wallet, fees included. Counted by the daily cap. */
  outflowUsd: string;
  summary: string;
  createdAt: Date;
  settledAt: Date | null;
}

export interface Contact {
  label: string;
  address: Address;
}

export interface BalanceSnapshot {
  spendableUsd: string;
  investmentsUsd: string;
  takenAt: Date;
}

export interface SessionRecord {
  id: string;
  permissions: SessionPermissions;
  createdAt: Date;
  /** Set the moment the user revokes. A revoked session is never resurrected. */
  revokedAt: Date | null;
}

export class DuplicateExecutionError extends Error {
  constructor() {
    super('This plan has already been executed.');
    this.name = 'DuplicateExecutionError';
  }
}

/**
 * Notes Blocky keeps about one user. Short on purpose: they ride along with
 * every message, so thirty short notes cost a few hundred tokens — cheap —
 * where an unbounded list would quietly become most of every bill.
 */
export const MAX_MEMORIES = 30;
const MAX_MEMORY_CHARS = 200;

/* -------------------------------------------------------------------------- */
/*  Money between people, and what the user should know about                  */
/* -------------------------------------------------------------------------- */

/** "@sam": 3–20 of a–z, 0–9 and _, starting with a letter. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

/** Names nobody gets: they would read as Blocky speaking. */
const RESERVED_USERNAMES = new Set(['blocky', 'admin', 'support', 'help', 'team', 'official', 'security', 'wallet']);

export function normaliseUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

export interface PublicUser {
  id: string;
  walletAddress: Address;
  username: string;
}

export interface PaymentRequest {
  id: string;
  requesterId: string;
  requesterUsername: string | null;
  requesterWallet: Address;
  payerId: string | null;
  payerUsername: string | null;
  /** USD decimal string. */
  amountUsd: string;
  note: string | null;
  status: 'open' | 'paid' | 'declined' | 'cancelled';
  /** From someone the payer has never dealt with: kept out of their notifications. */
  fromStranger: boolean;
  planId: string | null;
  txHash: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: unknown;
  read: boolean;
  createdAt: string;
}

export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  direction: 'above' | 'below';
  thresholdUsd: string;
  createdAt: string;
  triggeredAt: string | null;
}

export interface Pot {
  id: string;
  name: string;
  targetUsd: string | null;
  savedUsd: string;
  createdAt: string;
}

export interface Store {
  /** Create or refresh a user. The wallet address comes from Privy, never the client. */
  upsertUser(user: UserRecord): Promise<void>;
  getUser(userId: string): Promise<UserRecord | null>;

  getPolicy(userId: string): Promise<Policy>;
  setPolicy(userId: string, policy: Policy): Promise<void>;

  /** Plans are short-lived; held only between proposal and execution. */
  putPlan(userId: string, plan: Plan, origin: PlanOrigin): Promise<void>;
  getPlan(userId: string, planId: string): Promise<StoredPlan | null>;

  /**
   * Record a submitted transaction. Throws {@link DuplicateExecutionError} if
   * the plan has already been executed — a plan runs at most once.
   */
  recordExecution(
    userId: string,
    execution: Omit<Execution, 'id' | 'status' | 'createdAt' | 'settledAt'>,
  ): Promise<Execution>;
  settleExecution(executionId: string, status: 'success' | 'reverted', now?: Date): Promise<void>;
  listExecutions(userId: string, limit?: number): Promise<Execution[]>;
  getExecution(userId: string, executionId: string): Promise<Execution | null>;

  /**
   * Agent-initiated spend in the trailing 24 hours.
   *
   * Counts pending as well as settled executions, so two quick sends cannot
   * both squeeze under the cap while the first is still confirming. Reverted
   * ones are excluded: nothing left the wallet.
   */
  spentTodayUsd(userId: string, now?: Date): Promise<string>;

  addKnownRecipient(userId: string, address: Address): Promise<void>;
  isKnownRecipient(userId: string, address: Address): Promise<boolean>;

  /**
   * The agent's session key, and the switch that kills it.
   *
   * Revocation here is immediate and server-side. It is not the whole story —
   * the on-chain validator is what holds if this server is compromised — but it
   * is the part that responds instantly, and it is what the user's revoke
   * button actually touches.
   */
  putSession(userId: string, session: SessionRecord): Promise<void>;
  activeSession(userId: string, chainId: ChainId, now?: Date): Promise<SessionRecord | null>;
  revokeSessions(userId: string, now?: Date): Promise<number>;

  /**
   * Saved contacts, by label.
   *
   * Labels are how a person actually refers to a recipient — "Sam", "rent" —
   * and they are the only free-text handle the model may use for a destination.
   * That is safe precisely because a label resolves against this list or fails:
   * the model cannot invent one that happens to work.
   */
  saveContact(userId: string, label: string, address: Address): Promise<void>;
  findContact(userId: string, label: string): Promise<Contact | null>;
  listContacts(userId: string): Promise<Contact[]>;
  deleteContact(userId: string, label: string): Promise<boolean>;

  /** What Blocky remembers about the user, oldest first. */
  listMemories(userId: string): Promise<Array<{ id: string; note: string }>>;
  /**
   * Remember a note. Refused when it repeats one already kept, or when the
   * user already has {@link MAX_MEMORIES} — old notes are forgotten on purpose,
   * never silently pushed out.
   */
  addMemory(userId: string, note: string): Promise<{ saved: boolean; reason?: string }>;
  /** Forget the note with this id. */
  forgetMemory(userId: string, id: string): Promise<boolean>;

  /** Every move the user made that landed since a time, with the plan behind it — for insights. */
  listSettledMoves(userId: string, since: Date): Promise<Array<{ plan: Plan; at: string }>>;
  /** What other Blocky users sent this wallet since a time. */
  listReceivedFromUsers(wallet: Address, since: Date): Promise<Array<{ from: string; usd: string; at: string }>>;

  /** Claim a username. `taken` when someone else has it; `invalid` when it breaks the rules. */
  setUsername(userId: string, username: string): Promise<'ok' | 'taken' | 'invalid'>;
  getUsername(userId: string): Promise<string | null>;
  findUserByUsername(username: string): Promise<PublicUser | null>;
  /** The Blocky user behind a wallet, if any — so a payment to them can tell them. */
  findUserByWallet(address: Address): Promise<PublicUser | null>;

  createPaymentRequest(request: {
    requesterId: string;
    payerId: string | null;
    amountUsd: string;
    note: string | null;
    fromStranger?: boolean;
  }): Promise<PaymentRequest>;
  /**
   * Whether a user has dealt with another before: saved them as a contact,
   * sent them money, or been paid by them. Requests from anyone else are
   * treated as from a stranger.
   */
  knowsUser(userId: string, other: { id: string; walletAddress: Address }): Promise<boolean>;
  /** Open requests from one user to another, and requests a user made since a time — for rate limits. */
  countOpenRequests(requesterId: string, payerId: string): Promise<number>;
  countRequestsSince(requesterId: string, since: Date): Promise<number>;
  blockUser(userId: string, blockedId: string): Promise<void>;
  isBlocked(userId: string, byUserId: string): Promise<boolean>;
  getPaymentRequest(id: string): Promise<PaymentRequest | null>;
  /** Requests the user made, and requests made of them — open ones first, newest first. */
  listPaymentRequests(userId: string): Promise<{ incoming: PaymentRequest[]; outgoing: PaymentRequest[] }>;
  /** Tie a request to the plan paying it, so its landing settles the request. */
  linkRequestPlan(id: string, planId: string): Promise<void>;
  findRequestByPlan(planId: string): Promise<PaymentRequest | null>;
  settleRequest(id: string, status: 'paid' | 'declined' | 'cancelled', txHash?: string): Promise<void>;

  notify(userId: string, notification: { kind: string; title: string; body: string; data?: unknown }): Promise<void>;
  listNotifications(userId: string, limit?: number): Promise<Notification[]>;
  markNotificationsRead(userId: string): Promise<void>;

  addPriceAlert(userId: string, alert: { symbol: string; direction: 'above' | 'below'; thresholdUsd: string }): Promise<PriceAlert>;
  listPriceAlerts(userId: string): Promise<PriceAlert[]>;
  deletePriceAlert(userId: string, id: string): Promise<boolean>;
  /** Every alert still waiting to fire, across all users — for the checker. */
  listOpenPriceAlerts(): Promise<PriceAlert[]>;
  markPriceAlertTriggered(id: string): Promise<void>;

  /** Set a monthly budget for a category; null removes it. */
  setBudget(userId: string, category: string, monthlyUsd: string | null): Promise<void>;
  listBudgets(userId: string): Promise<Array<{ category: string; monthlyUsd: string }>>;

  createPot(userId: string, pot: { name: string; targetUsd: string | null }): Promise<Pot>;
  listPots(userId: string): Promise<Pot[]>;
  /** Move money into (positive) or out of (negative) a pot. Never below zero. */
  adjustPot(userId: string, id: string, deltaUsd: string): Promise<Pot | null>;
  deletePot(userId: string, id: string): Promise<boolean>;

  /** Remember a token the user bought by contract, so their portfolio shows it. Idempotent. */
  trackToken(userId: string, token: TrackedToken): Promise<void>;
  listTrackedTokens(userId: string): Promise<TrackedToken[]>;

  /**
   * Record a balance snapshot, throttled to at most one per `minIntervalMs`
   * (default one hour) per user. Called opportunistically off a real
   * `/v1/balance` read, so history accrues at however often the app actually
   * asks — never backfilled, never a guess at a time nobody checked.
   */
  recordBalanceSnapshot(
    userId: string,
    values: { spendableUsd: string; investmentsUsd: string },
    now?: Date,
    minIntervalMs?: number,
  ): Promise<void>;
  /** Snapshots since `since`, oldest first — a line chart reads left to right. */
  listBalanceSnapshots(userId: string, since: Date): Promise<BalanceSnapshot[]>;
}

/** Labels match case- and whitespace-insensitively: users type "sam", not "Sam". */
function contactKey(label: string): string {
  return label.trim().toLowerCase();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres reports a unique-constraint violation with this SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

export function createStore(db: Db): Store {
  async function readPolicy(userId: string): Promise<Policy> {
    const [row] = await db.select().from(policies).where(eq(policies.userId, userId));

    if (!row) return DEFAULT_POLICY;

    // Stored JSON is re-validated on the way out. A policy that no longer
    // parses — an old shape, a hand edit — falls back to the conservative
    // default rather than being trusted.
    const parsed = PolicySchema.safeParse(row.policy);
    if (!parsed.success) return DEFAULT_POLICY;

    /*
     * `allowedActions` has never been something the user can edit — no screen
     * sets it — so a stored `['transfer']` is the old default, saved alongside
     * limits the user did choose. Read it as today's default. A list anyone
     * actually narrowed would not look like this one.
     */
    // The same for `tokenAllowlist`: no screen edits it, so a stored list is
    // an old default rather than a choice — today's default is any verified token.
    const actions = parsed.data.allowedActions;
    const tokens = parsed.data.tokenAllowlist;
    return {
      ...parsed.data,
      ...(actions.length === 1 && actions[0] === 'transfer' ? { allowedActions: DEFAULT_POLICY.allowedActions } : {}),
      ...(tokens !== null ? { tokenAllowlist: DEFAULT_POLICY.tokenAllowlist } : {}),
    };
  }

  async function loadRequest(id: string): Promise<PaymentRequest | null> {
    const [row] = await requestRows(eq(paymentRequests.id, id));
    return row ?? null;
  }

  async function requestRows(where: ReturnType<typeof eq>): Promise<PaymentRequest[]> {
    const rows = await db.select().from(paymentRequests).where(where).orderBy(desc(paymentRequests.createdAt)).limit(100);
    if (rows.length === 0) return [];
    const people = await db
      .select({ id: users.id, username: users.username, walletAddress: users.walletAddress })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.flatMap((row) => [row.requesterId, row.payerId]).filter((id): id is string => id !== null))]));
    const who = new Map(people.map((person) => [person.id, person]));
    return rows
      .map((row) => ({
        id: row.id,
        requesterId: row.requesterId,
        requesterUsername: who.get(row.requesterId)?.username ?? null,
        requesterWallet: (who.get(row.requesterId)?.walletAddress ?? '0x') as Address,
        payerId: row.payerId,
        payerUsername: row.payerId ? (who.get(row.payerId)?.username ?? null) : null,
        amountUsd: formatUsd(parseUsd(row.amountUsd)),
        note: row.note,
        status: row.status,
        fromStranger: row.fromStranger,
        planId: row.planId,
        txHash: row.txHash,
        createdAt: row.createdAt.toISOString(),
        settledAt: row.settledAt?.toISOString() ?? null,
      }))
      .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
  }

  async function potRow(userId: string, id: string): Promise<Pot | null> {
    const [row] = await db.select().from(pots).where(and(eq(pots.userId, userId), eq(pots.id, id)));
    return row ? toPot(row) : null;
  }

  async function writePolicy(userId: string, policy: Policy): Promise<void> {
    await db
      .insert(policies)
      .values({ userId, policy })
      .onConflictDoUpdate({
        target: policies.userId,
        set: { policy, updatedAt: new Date() },
      });
  }

  return {
    async upsertUser(user) {
      await db
        .insert(users)
        .values({ id: user.id, walletAddress: user.walletAddress.toLowerCase() })
        .onConflictDoUpdate({
          target: users.id,
          set: { walletAddress: user.walletAddress.toLowerCase() },
        });
    },

    async getUser(userId) {
      const [row] = await db.select().from(users).where(eq(users.id, userId));
      return row ? { id: row.id, walletAddress: row.walletAddress as Address } : null;
    },

    getPolicy: readPolicy,
    setPolicy: writePolicy,

    async putPlan(userId, plan, origin) {
      await db.insert(plans).values({
        id: plan.id,
        userId,
        origin,
        plan,
        expiresAt: new Date(plan.expiresAt),
      });
    },

    async getPlan(userId, planId) {
      const [row] = await db
        .select()
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.userId, userId)));

      return row ? { plan: row.plan as Plan, origin: row.origin } : null;
    },

    async recordExecution(userId, execution) {
      const row = {
        id: crypto.randomUUID(),
        userId,
        planId: execution.planId,
        origin: execution.origin,
        chainId: execution.chainId,
        txHash: execution.txHash.toLowerCase(),
        status: 'pending' as const,
        counterparty: execution.counterparty.toLowerCase(),
        amount: execution.amount,
        outflowUsd: execution.outflowUsd,
        summary: execution.summary,
      };

      try {
        const [inserted] = await db.insert(executions).values(row).returning();
        if (!inserted) throw new Error('Execution insert returned nothing');
        return toExecution(inserted);
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateExecutionError();
        throw error;
      }
    },

    async settleExecution(executionId, status, now = new Date()) {
      await db
        .update(executions)
        .set({ status, settledAt: now })
        // Only a pending execution settles. A settled one is history.
        .where(and(eq(executions.id, executionId), eq(executions.status, 'pending')));
    },

    async listExecutions(userId, limit = 50) {
      const rows = await db
        .select()
        .from(executions)
        .where(eq(executions.userId, userId))
        .orderBy(desc(executions.createdAt))
        .limit(limit);

      return rows.map(toExecution);
    },

    async getExecution(userId, executionId) {
      const [row] = await db
        .select()
        .from(executions)
        .where(and(eq(executions.id, executionId), eq(executions.userId, userId)));

      return row ? toExecution(row) : null;
    },

    async spentTodayUsd(userId, now = new Date()) {
      const [row] = await db
        .select({ total: sql<string | null>`sum(${executions.outflowUsd})` })
        .from(executions)
        .where(
          and(
            eq(executions.userId, userId),
            eq(executions.origin, 'agent'),
            inArray(executions.status, ['pending', 'success']),
            gte(executions.createdAt, new Date(now.getTime() - DAY_MS)),
          ),
        );

      // numeric(38,6) comes back as a string like "20.100000"; normalise it.
      return row?.total ? formatUsd(parseUsd(row.total)) : '0';
    },

    async addKnownRecipient(userId, address) {
      const normalised = address.toLowerCase() as Address;

      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(policies)
          .where(eq(policies.userId, userId))
          .for('update');

        const current = row ? PolicySchema.safeParse(row.policy) : null;
        const policy = current?.success ? current.data : DEFAULT_POLICY;

        if (policy.recipientAllowlist.includes(normalised)) return;

        const next = { ...policy, recipientAllowlist: [...policy.recipientAllowlist, normalised] };

        await tx
          .insert(policies)
          .values({ userId, policy: next })
          .onConflictDoUpdate({ target: policies.userId, set: { policy: next, updatedAt: new Date() } });
      });
    },

    async isKnownRecipient(userId, address) {
      const policy = await readPolicy(userId);
      return policy.recipientAllowlist.includes(address.toLowerCase() as Address);
    },

    async putSession(userId, session) {
      await db.insert(sessions).values({
        id: session.id,
        userId,
        chainId: session.permissions.chainId,
        permissions: serialisePermissions(session.permissions),
        validUntil: new Date(session.permissions.validUntil * 1000),
        createdAt: session.createdAt,
        revokedAt: session.revokedAt,
      });
    },

    async activeSession(userId, chainId, now = new Date()) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.chainId, chainId),
            isNull(sessions.revokedAt),
            gt(sessions.validUntil, now),
          ),
        )
        // Newest wins. Minting a session supersedes the one before it.
        .orderBy(desc(sessions.createdAt))
        .limit(1);

      if (!row) return null;

      return {
        id: row.id,
        permissions: deserialisePermissions(row.permissions),
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
      };
    },

    async revokeSessions(userId, now = new Date()) {
      const revoked = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });

      return revoked.length;
    },

    async saveContact(userId, label, address) {
      const key = contactKey(label);
      // Store the label as the user typed it; match on the normalised form.
      const values = { userId, labelKey: key, label: label.trim(), address: address.toLowerCase() };

      await db
        .insert(contacts)
        .values(values)
        .onConflictDoUpdate({
          target: [contacts.userId, contacts.labelKey],
          set: { label: values.label, address: values.address },
        });
    },

    async findContact(userId, label) {
      const [row] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.labelKey, contactKey(label))));

      return row ? { label: row.label, address: row.address as Address } : null;
    },

    async listContacts(userId) {
      const rows = await db
        .select()
        .from(contacts)
        .where(eq(contacts.userId, userId))
        .orderBy(contacts.label);

      return rows.map((row) => ({ label: row.label, address: row.address as Address }));
    },

    async listSettledMoves(userId, since) {
      const rows = await db
        .select({ plan: plans.plan, at: executions.createdAt })
        .from(executions)
        .innerJoin(plans, eq(plans.id, executions.planId))
        .where(and(eq(executions.userId, userId), eq(executions.status, 'success'), gte(executions.createdAt, since)))
        .orderBy(executions.createdAt);
      return rows.map((row) => ({ plan: row.plan as Plan, at: row.at.toISOString() }));
    },

    async listReceivedFromUsers(wallet, since) {
      const rows = await db
        .select({ from: users.username, usd: executions.amount, at: executions.createdAt })
        .from(executions)
        .innerJoin(users, eq(users.id, executions.userId))
        .where(
          and(eq(executions.counterparty, wallet.toLowerCase()), eq(executions.status, 'success'), gte(executions.createdAt, since)),
        );
      return rows.map((row) => ({ from: row.from ? `@${row.from}` : 'Someone', usd: formatUsd(parseUsd(row.usd)), at: row.at.toISOString() }));
    },

    async setUsername(userId, input) {
      const username = normaliseUsername(input);
      if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(username)) return 'invalid';
      const [holder] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
      if (holder && holder.id !== userId) return 'taken';
      try {
        await db.update(users).set({ username }).where(eq(users.id, userId));
      } catch {
        // Claimed in the moment between the check and the write.
        return 'taken';
      }
      return 'ok';
    },

    async getUsername(userId) {
      const [row] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
      return row?.username ?? null;
    },

    async findUserByUsername(input) {
      const username = normaliseUsername(input);
      if (!USERNAME_PATTERN.test(username)) return null;
      const [row] = await db.select().from(users).where(eq(users.username, username));
      return row?.username ? { id: row.id, walletAddress: row.walletAddress as Address, username: row.username } : null;
    },

    async findUserByWallet(address) {
      const [row] = await db.select().from(users).where(eq(users.walletAddress, address.toLowerCase()));
      return row?.username ? { id: row.id, walletAddress: row.walletAddress as Address, username: row.username } : null;
    },

    async createPaymentRequest(request) {
      const id = crypto.randomUUID();
      await db.insert(paymentRequests).values({
        id,
        requesterId: request.requesterId,
        payerId: request.payerId,
        amountUsd: request.amountUsd,
        note: request.note,
        status: 'open',
        fromStranger: request.fromStranger ?? false,
      });
      return (await loadRequest(id))!;
    },

    getPaymentRequest: loadRequest,

    async knowsUser(userId, other) {
      const wallet = other.walletAddress.toLowerCase();
      const [contact] = await db
        .select({ label: contacts.label })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.address, wallet)))
        .limit(1);
      if (contact) return true;

      const me = await db.select({ walletAddress: users.walletAddress }).from(users).where(eq(users.id, userId));
      const mine = me[0]?.walletAddress.toLowerCase();

      // Money either way, that landed.
      const [dealt] = await db
        .select({ id: executions.id })
        .from(executions)
        .where(
          and(
            eq(executions.status, 'success'),
            sql`((${executions.userId} = ${userId} and ${executions.counterparty} = ${wallet}) or (${executions.userId} = ${other.id} and ${executions.counterparty} = ${mine ?? ''}))`,
          ),
        )
        .limit(1);
      return Boolean(dealt);
    },

    async countOpenRequests(requesterId, payerId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(paymentRequests)
        .where(and(eq(paymentRequests.requesterId, requesterId), eq(paymentRequests.payerId, payerId), eq(paymentRequests.status, 'open')));
      return row?.n ?? 0;
    },

    async countRequestsSince(requesterId, since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(paymentRequests)
        .where(and(eq(paymentRequests.requesterId, requesterId), gte(paymentRequests.createdAt, since)));
      return row?.n ?? 0;
    },

    async blockUser(userId, blockedId) {
      await db.insert(blockedUsers).values({ userId, blockedId }).onConflictDoNothing();
      // Anything they already asked goes too.
      await db
        .update(paymentRequests)
        .set({ status: 'declined', settledAt: new Date() })
        .where(and(eq(paymentRequests.payerId, userId), eq(paymentRequests.requesterId, blockedId), eq(paymentRequests.status, 'open')));
    },

    async isBlocked(userId, byUserId) {
      const [row] = await db
        .select({ id: blockedUsers.userId })
        .from(blockedUsers)
        .where(and(eq(blockedUsers.userId, byUserId), eq(blockedUsers.blockedId, userId)));
      return Boolean(row);
    },

    async listPaymentRequests(userId) {
      const [incoming, outgoing] = await Promise.all([
        requestRows(eq(paymentRequests.payerId, userId)),
        requestRows(eq(paymentRequests.requesterId, userId)),
      ]);
      return { incoming, outgoing };
    },

    async linkRequestPlan(id, planId) {
      await db.update(paymentRequests).set({ planId }).where(eq(paymentRequests.id, id));
    },

    async findRequestByPlan(planId) {
      const [row] = await db.select({ id: paymentRequests.id }).from(paymentRequests).where(eq(paymentRequests.planId, planId));
      return row ? loadRequest(row.id) : null;
    },

    async settleRequest(id, status, txHash) {
      await db
        .update(paymentRequests)
        .set({ status, settledAt: new Date(), ...(txHash ? { txHash } : {}) })
        .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, 'open')));
    },

    async notify(userId, notification) {
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId,
        kind: notification.kind,
        title: notification.title.slice(0, 120),
        body: notification.body.slice(0, 400),
        data: notification.data ?? null,
      });
    },

    async listNotifications(userId, limit = 50) {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        data: row.data,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async markNotificationsRead(userId) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    },

    async addPriceAlert(userId, alert) {
      const id = crypto.randomUUID();
      await db.insert(priceAlerts).values({ id, userId, symbol: alert.symbol.toUpperCase(), direction: alert.direction, thresholdUsd: alert.thresholdUsd });
      const [row] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, id));
      return toAlert(row!);
    },

    async listPriceAlerts(userId) {
      const rows = await db.select().from(priceAlerts).where(eq(priceAlerts.userId, userId)).orderBy(desc(priceAlerts.createdAt));
      return rows.map(toAlert);
    },

    async deletePriceAlert(userId, id) {
      const removed = await db
        .delete(priceAlerts)
        .where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.id, id)))
        .returning({ id: priceAlerts.id });
      return removed.length > 0;
    },

    async listOpenPriceAlerts() {
      return (await db.select().from(priceAlerts).where(isNull(priceAlerts.triggeredAt))).map(toAlert);
    },

    async markPriceAlertTriggered(id) {
      await db.update(priceAlerts).set({ triggeredAt: new Date() }).where(eq(priceAlerts.id, id));
    },

    async setBudget(userId, category, monthlyUsd) {
      const key = category.trim().toLowerCase();
      if (monthlyUsd === null) {
        await db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.category, key)));
        return;
      }
      await db
        .insert(budgets)
        .values({ userId, category: key, monthlyUsd })
        .onConflictDoUpdate({ target: [budgets.userId, budgets.category], set: { monthlyUsd } });
    },

    async listBudgets(userId) {
      const rows = await db.select().from(budgets).where(eq(budgets.userId, userId));
      return rows.map((row) => ({ category: row.category, monthlyUsd: formatUsd(parseUsd(row.monthlyUsd)) }));
    },

    async createPot(userId, pot) {
      const id = crypto.randomUUID();
      await db.insert(pots).values({ id, userId, name: pot.name.trim().slice(0, 40), targetUsd: pot.targetUsd, savedUsd: '0' });
      return (await potRow(userId, id))!;
    },

    async listPots(userId) {
      const rows = await db.select().from(pots).where(eq(pots.userId, userId)).orderBy(pots.createdAt);
      return rows.map(toPot);
    },

    async adjustPot(userId, id, deltaUsd) {
      const pot = await potRow(userId, id);
      if (!pot) return null;
      // Signed: "-20" takes money out.
      const delta = deltaUsd.trim().startsWith('-') ? -parseUsd(deltaUsd.trim().slice(1)) : parseUsd(deltaUsd.trim());
      const next = parseUsd(pot.savedUsd) + delta;
      await db.update(pots).set({ savedUsd: formatUsd(next > 0n ? next : 0n) }).where(eq(pots.id, id));
      return potRow(userId, id);
    },

    async deletePot(userId, id) {
      const removed = await db.delete(pots).where(and(eq(pots.userId, userId), eq(pots.id, id))).returning({ id: pots.id });
      return removed.length > 0;
    },

    async trackToken(userId, token) {
      await db
        .insert(trackedTokens)
        .values({ userId, chainId: token.chainId, address: token.address.toLowerCase(), symbol: token.symbol.slice(0, 20), decimals: token.decimals })
        .onConflictDoNothing();
    },

    async listTrackedTokens(userId) {
      const rows = await db.select().from(trackedTokens).where(eq(trackedTokens.userId, userId));
      return rows.map((row) => ({
        chainId: row.chainId as ChainId,
        address: row.address as Address,
        symbol: row.symbol,
        decimals: row.decimals,
      }));
    },

    async listMemories(userId) {
      const rows = await db
        .select({ id: memories.id, note: memories.note })
        .from(memories)
        .where(eq(memories.userId, userId))
        .orderBy(memories.createdAt);
      return rows;
    },

    async addMemory(userId, note) {
      const text = note.trim().replace(/\s+/g, ' ').slice(0, MAX_MEMORY_CHARS);
      if (!text) return { saved: false, reason: 'Nothing to remember.' };

      const existing = await db.select({ note: memories.note }).from(memories).where(eq(memories.userId, userId));
      if (existing.some((row) => row.note.toLowerCase() === text.toLowerCase())) {
        return { saved: false, reason: 'Already remembered.' };
      }
      if (existing.length >= MAX_MEMORIES) {
        return { saved: false, reason: `Memory is full (${MAX_MEMORIES} notes). Forget an old one first.` };
      }

      await db.insert(memories).values({ id: crypto.randomUUID(), userId, note: text });
      return { saved: true };
    },

    async forgetMemory(userId, id) {
      const removed = await db
        .delete(memories)
        .where(and(eq(memories.userId, userId), eq(memories.id, id)))
        .returning({ id: memories.id });
      return removed.length > 0;
    },

    async deleteContact(userId, label) {
      const removed = await db
        .delete(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.labelKey, contactKey(label))))
        .returning({ key: contacts.labelKey });

      return removed.length > 0;
    },

    async recordBalanceSnapshot(userId, values, now = new Date(), minIntervalMs = 60 * 60 * 1000) {
      const [latest] = await db
        .select({ takenAt: balanceSnapshots.takenAt })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.userId, userId))
        .orderBy(desc(balanceSnapshots.takenAt))
        .limit(1);

      if (latest && now.getTime() - latest.takenAt.getTime() < minIntervalMs) return;

      await db.insert(balanceSnapshots).values({
        id: crypto.randomUUID(),
        userId,
        spendableUsd: values.spendableUsd,
        investmentsUsd: values.investmentsUsd,
        takenAt: now,
      });
    },

    async listBalanceSnapshots(userId, since) {
      const rows = await db
        .select()
        .from(balanceSnapshots)
        .where(and(eq(balanceSnapshots.userId, userId), gte(balanceSnapshots.takenAt, since)))
        .orderBy(balanceSnapshots.takenAt);

      return rows.map((row) => ({
        spendableUsd: formatUsd(parseUsd(row.spendableUsd)),
        investmentsUsd: formatUsd(parseUsd(row.investmentsUsd)),
        takenAt: row.takenAt,
      }));
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toExecution(row: typeof executions.$inferSelect): Execution {
  return {
    id: row.id,
    planId: row.planId,
    origin: row.origin,
    chainId: row.chainId as ChainId,
    txHash: row.txHash,
    status: row.status,
    counterparty: row.counterparty as Address,
    amount: formatUsd(parseUsd(row.amount)),
    outflowUsd: formatUsd(parseUsd(row.outflowUsd)),
    summary: row.summary,
    createdAt: row.createdAt,
    settledAt: row.settledAt,
  };
}

/** JSON has no bigint. Spend limits cross into storage as decimal strings. */
function serialisePermissions(permissions: SessionPermissions) {
  return {
    ...permissions,
    spendLimits: permissions.spendLimits.map((limit) => ({
      token: limit.token,
      limit: limit.limit.toString(),
    })),
  };
}

function deserialisePermissions(stored: unknown): SessionPermissions {
  const value = stored as ReturnType<typeof serialisePermissions>;

  return {
    ...value,
    spendLimits: value.spendLimits.map((limit) => ({
      token: limit.token,
      limit: BigInt(limit.limit),
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  // node-postgres puts the SQLSTATE on the error; PGlite does too, and drizzle
  // may wrap either one in `cause`.
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

function toAlert(row: typeof priceAlerts.$inferSelect): PriceAlert {
  return {
    id: row.id,
    userId: row.userId,
    symbol: row.symbol,
    direction: row.direction,
    thresholdUsd: formatUsd(parseUsd(row.thresholdUsd)),
    createdAt: row.createdAt.toISOString(),
    triggeredAt: row.triggeredAt?.toISOString() ?? null,
  };
}

function toPot(row: typeof pots.$inferSelect): Pot {
  return {
    id: row.id,
    name: row.name,
    targetUsd: row.targetUsd === null ? null : formatUsd(parseUsd(row.targetUsd)),
    savedUsd: formatUsd(parseUsd(row.savedUsd)),
    createdAt: row.createdAt.toISOString(),
  };
}
