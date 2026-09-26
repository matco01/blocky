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
import { balanceSnapshots, contacts, executions, memories, plans, policies, sessions, trackedTokens, users } from './db/schema';

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
