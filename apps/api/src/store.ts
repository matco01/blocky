import { DEFAULT_POLICY, sumUsd, type Address, type Plan, type Policy } from '@blocky/shared';

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
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createMemoryStore(): Store {
  const policies = new Map<string, Policy>();
  const activity = new Map<string, AgentActivity[]>();
  const plans = new Map<string, Plan>();

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
  };
}
