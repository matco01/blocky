import { DEFAULT_POLICY, sumUsd, type Address, type ChainId, type Plan, type Policy } from '@blocky/shared';
import type { SessionPermissions } from '@blocky/wallet-core';

/**
 * Persistence, behind an interface.
 *
 * M0 runs on an in-memory implementation so the stack boots with no database to
 * provision — you can clone the repo and have it running in a minute. The
 * interface is the real deliverable; a Drizzle/Postgres implementation drops in
 * behind it at M1 without touching a route.
 *
 * ⚠️  In-memory means every restart forgets the user's policy and their spend
 * history. That is fine for a testnet demo and unacceptable the moment real
 * money is involved, because forgetting today's spend resets the daily cap.
 */

export interface AgentActivity {
  id: string;
  userId: string;
  planId: string;
  /** USD value that left the wallet, for rolling daily-cap arithmetic. */
  outflowUsd: string;
  createdAt: Date;
}

export interface Store {
  getPolicy(userId: string): Promise<Policy>;
  setPolicy(userId: string, policy: Policy): Promise<void>;

  /** Agent-initiated spend in the trailing 24 hours. */
  spentTodayUsd(userId: string, now?: Date): Promise<string>;
  recordActivity(activity: AgentActivity): Promise<void>;

  /** Plans are short-lived; held only between proposal and execution. */
  putPlan(userId: string, plan: Plan): Promise<void>;
  getPlan(userId: string, planId: string): Promise<Plan | null>;

  addKnownRecipient(userId: string, address: Address): Promise<void>;
  isKnownRecipient(userId: string, address: Address): Promise<boolean>;

  /**
   * Saved contacts, by label.
   *
   * Labels are how a person actually refers to a recipient — "Sam", "rent" —
   * and they are the only free-text handle the model may use for a destination.
   * That is safe precisely because a label resolves against this list or fails:
   * the model cannot invent one that happens to work.
   */
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

  saveContact(userId: string, label: string, address: Address): Promise<void>;
  findContact(userId: string, label: string): Promise<Contact | null>;
  listContacts(userId: string): Promise<Contact[]>;
  deleteContact(userId: string, label: string): Promise<boolean>;
}

export interface Contact {
  label: string;
  address: Address;
}

export interface SessionRecord {
  id: string;
  permissions: SessionPermissions;
  createdAt: Date;
  /** Set the moment the user revokes. A revoked session is never resurrected. */
  revokedAt: Date | null;
}

/** Labels match case- and whitespace-insensitively: users type "sam", not "Sam". */
function contactKey(label: string): string {
  return label.trim().toLowerCase();
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createMemoryStore(): Store {
  const policies = new Map<string, Policy>();
  const activity = new Map<string, AgentActivity[]>();
  const plans = new Map<string, Plan>();
  const contacts = new Map<string, Map<string, Contact>>();
  const sessions = new Map<string, SessionRecord[]>();

  const planKey = (userId: string, planId: string) => `${userId}:${planId}`;

  return {
    async getPolicy(userId) {
      return policies.get(userId) ?? DEFAULT_POLICY;
    },

    async setPolicy(userId, policy) {
      policies.set(userId, policy);
    },

    async spentTodayUsd(userId, now = new Date()) {
      const cutoff = now.getTime() - DAY_MS;
      const entries = (activity.get(userId) ?? []).filter(
        (a) => a.createdAt.getTime() >= cutoff,
      );

      return sumUsd(entries.map((a) => a.outflowUsd));
    },

    async recordActivity(entry) {
      const existing = activity.get(entry.userId) ?? [];
      existing.push(entry);
      activity.set(entry.userId, existing);
    },

    async putPlan(userId, plan) {
      plans.set(planKey(userId, plan.id), plan);
    },

    async getPlan(userId, planId) {
      return plans.get(planKey(userId, planId)) ?? null;
    },

    async addKnownRecipient(userId, address) {
      const policy = policies.get(userId) ?? DEFAULT_POLICY;
      if (policy.recipientAllowlist.includes(address)) return;

      policies.set(userId, {
        ...policy,
        recipientAllowlist: [...policy.recipientAllowlist, address],
      });
    },

    async isKnownRecipient(userId, address) {
      const policy = policies.get(userId) ?? DEFAULT_POLICY;
      return policy.recipientAllowlist.includes(address);
    },

    async putSession(userId, session) {
      sessions.set(userId, [...(sessions.get(userId) ?? []), session]);
    },

    async activeSession(userId, chainId, now = new Date()) {
      const candidates = (sessions.get(userId) ?? []).filter(
        (session) =>
          session.revokedAt === null &&
          session.permissions.chainId === chainId &&
          session.permissions.validUntil * 1000 > now.getTime(),
      );

      // Newest wins. Minting a session supersedes the one before it.
      return candidates.at(-1) ?? null;
    },

    async revokeSessions(userId, now = new Date()) {
      const existing = sessions.get(userId) ?? [];
      let revoked = 0;

      for (const session of existing) {
        if (session.revokedAt === null) {
          session.revokedAt = now;
          revoked += 1;
        }
      }

      return revoked;
    },

    async saveContact(userId, label, address) {
      const book = contacts.get(userId) ?? new Map<string, Contact>();

      // Store the label as the user typed it; match on the normalised form.
      book.set(contactKey(label), { label: label.trim(), address });
      contacts.set(userId, book);
    },

    async findContact(userId, label) {
      return contacts.get(userId)?.get(contactKey(label)) ?? null;
    },

    async listContacts(userId) {
      return [...(contacts.get(userId)?.values() ?? [])];
    },

    async deleteContact(userId, label) {
      return contacts.get(userId)?.delete(contactKey(label)) ?? false;
    },
  };
}
