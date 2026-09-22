import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * The schema.
 *
 * Two rules carried over from the rest of the codebase:
 *
 *  - Money is `numeric(38, 6)`, never `real` or `double precision`. Postgres
 *    does the daily-cap sum, and it has to be as exact as the TypeScript that
 *    produced the numbers.
 *  - Addresses are stored lowercased, matching `AddressSchema`, so a lookup is
 *    never checksum-sensitive.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** A Privy user and the wallet Privy says they own. */
export const users = pgTable('users', {
  /** Privy DID. */
  id: text('id').primaryKey(),
  /**
   * Read from Privy's API, never from the client. With EIP-7702 this EOA
   * address is also the smart account address.
   */
  walletAddress: text('wallet_address').notNull(),
  createdAt: createdAt(),
});

/** The user's agent policy. Absent means `DEFAULT_POLICY`. */
export const policies = pgTable('policies', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  policy: jsonb('policy').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Plans, held between proposal and execution.
 *
 * Stored server-side so the client approves a plan by id. A plan posted back
 * from a client is a plan an attacker can edit.
 */
export const plans = pgTable(
  'plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `agent` plans count toward the daily cap; `manual` sends do not. */
    origin: text('origin', { enum: ['agent', 'manual'] }).notNull(),
    plan: jsonb('plan').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('plans_user_idx').on(table.userId)],
);

/**
 * Transactions we have seen submitted, and what became of them.
 *
 * `plan_id` is unique: a plan executes at most once. Without that, replaying
 * the "I submitted this" request could double-count spend — or, worse, the
 * client could be talked into signing the same plan twice.
 */
export const executions = pgTable(
  'executions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .unique()
      .references(() => plans.id),
    origin: text('origin', { enum: ['agent', 'manual'] }).notNull(),
    chainId: integer('chain_id').notNull(),
    txHash: text('tx_hash').notNull().unique(),
    status: text('status', { enum: ['pending', 'success', 'reverted'] }).notNull(),
    /** Who received it, lowercased. */
    counterparty: text('counterparty').notNull(),
    /** The transferred amount in USDC, excluding fees — what the feed shows. */
    amount: numeric('amount', { precision: 38, scale: 6 }).notNull(),
    /** USD that left the wallet including fees — what the daily cap counts. */
    outflowUsd: numeric('outflow_usd', { precision: 38, scale: 6 }).notNull(),
    summary: text('summary').notNull(),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [index('executions_user_created_idx').on(table.userId, table.createdAt)],
);

/** Saved contacts. Matched on a normalised label; displayed as typed. */
export const contacts = pgTable(
  'contacts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    labelKey: text('label_key').notNull(),
    label: text('label').notNull(),
    address: text('address').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.labelKey] })],
);

/** Agent session keys. A revoked session is never resurrected. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id').notNull(),
    /** `SessionPermissions`, with bigint spend limits stored as decimal strings. */
    permissions: jsonb('permissions').notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    onChain: boolean('on_chain').notNull().default(false),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

/**
 * A point-in-time read of the wallet's value, split the same way the
 * portfolio screen is: spendable (stablecoins — Arc plus Gateway) versus
 * investments (everything else). Taken opportunistically off the back of a
 * real `/v1/balance` read and throttled — never backfilled, never guessed at
 * a time nobody actually checked the wallet.
 */
export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spendableUsd: numeric('spendable_usd', { precision: 38, scale: 6 }).notNull(),
    investmentsUsd: numeric('investments_usd', { precision: 38, scale: 6 }).notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('balance_snapshots_user_taken_idx').on(table.userId, table.takenAt)],
);

export const schema = { users, policies, plans, executions, contacts, sessions, balanceSnapshots };
