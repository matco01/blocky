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
  /**
   * The name people pay them by — "@sam". Lower case, unique, chosen by the
   * user. Null until they pick one.
   */
  username: text('username').unique(),
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

/**
 * What Blocky remembers about a user between conversations: short notes it
 * wrote itself from what they said — "keeps $50 on Arc", "Mum is the contact
 * Maria". Loaded into every conversation; the user can have any one forgotten.
 */
export const memories = pgTable(
  'memories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('memories_user_idx').on(table.userId)],
);

/**
 * Tokens a user bought by contract address — memecoins and the like — so the
 * portfolio keeps showing them. No list knows them, and scanning every token
 * on every chain would need an indexer; remembering what they bought doesn't.
 */
export const trackedTokens = pgTable(
  'tracked_tokens',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id').notNull(),
    address: text('address').notNull(),
    symbol: text('symbol').notNull(),
    decimals: integer('decimals').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.chainId, table.address] })],
);

/**
 * Someone asking to be paid: "@sam, $25 for dinner". Addressed to another
 * Blocky user (who sees it as a card to pay), or to nobody in particular —
 * a link to share. Paid when a send to the requester for at least the amount,
 * made from this request, lands.
 */
export const paymentRequests = pgTable(
  'payment_requests',
  {
    id: text('id').primaryKey(),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who is asked. Null for a link anyone can pay. */
    payerId: text('payer_id').references(() => users.id, { onDelete: 'cascade' }),
    amountUsd: numeric('amount_usd', { precision: 38, scale: 6 }).notNull(),
    note: text('note'),
    status: text('status', { enum: ['open', 'paid', 'declined', 'cancelled'] }).notNull(),
    /** The plan the payer is paying it with — how a landed send is matched to it. */
    planId: text('plan_id'),
    /**
     * Asked by someone the payer has never dealt with: kept out of their
     * notifications, in a quiet "people you don't know" pile — so a stranger
     * can't use requests to spam them.
     */
    fromStranger: boolean('from_stranger').notNull().default(false),
    txHash: text('tx_hash'),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [index('payment_requests_payer_idx').on(table.payerId), index('payment_requests_requester_idx').on(table.requesterId)],
);

/** People a user blocked: requests from them are dropped without telling them. */
export const blockedUsers = pgTable(
  'blocked_users',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.blockedId] })],
);

/** What the user should know about, newest first: money in, requests, alerts. */
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('notifications_user_created_idx').on(table.userId, table.createdAt)],
);

/** "Tell me if ETH drops under $2,500." Fires once, then is done. */
export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    direction: text('direction', { enum: ['above', 'below'] }).notNull(),
    thresholdUsd: numeric('threshold_usd', { precision: 38, scale: 6 }).notNull(),
    createdAt: createdAt(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
  },
  (table) => [index('price_alerts_open_idx').on(table.triggeredAt)],
);

/** A monthly limit on one spending category, warned about at 80% and 100%. */
export const budgets = pgTable(
  'budgets',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    monthlyUsd: numeric('monthly_usd', { precision: 38, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category] })],
);

/**
 * Savings pots: named envelopes over the user's own balance — "Trip, $200 of
 * $500". The money never leaves their wallet (a separate account would need a
 * separate key); a pot is a commitment the app keeps for them.
 */
export const pots = pgTable(
  'pots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetUsd: numeric('target_usd', { precision: 38, scale: 6 }),
    savedUsd: numeric('saved_usd', { precision: 38, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('pots_user_idx').on(table.userId)],
);

export const schema = {
  users,
  policies,
  plans,
  executions,
  contacts,
  sessions,
  balanceSnapshots,
  memories,
  trackedTokens,
  paymentRequests,
  blockedUsers,
  notifications,
  priceAlerts,
  budgets,
  pots,
};
