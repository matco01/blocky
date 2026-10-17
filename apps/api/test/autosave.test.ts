import { CHAIN, parseUsd, type Plan } from '@blocky/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAutoSave, runCheckIns } from '../src/autosave';
import { openDatabase, type Database } from '../src/db/client';
import { createStore, type Store } from '../src/store';

/**
 * Auto-save moves no money, but it decides what counts as free — so the rules
 * that keep it honest are pinned here against a real (embedded) Postgres: never
 * more than is free, never past a goal, and money only counted once.
 */

const USER = 'did:privy:alice';
const WALLET = '0xa11ce00000000000000000000000000000000001';

let database: Database;
let store: Store;
let balance: bigint;
const balanceOf = async () => balance;

beforeAll(async () => {
  database = await openDatabase({});
  store = createStore(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`TRUNCATE executions, plans, sessions, contacts, policies, users CASCADE`);
  await store.upsertUser({ id: USER, walletAddress: WALLET });
  balance = parseUsd('100');
});

const saved = async (name: string) => (await store.listPots(USER)).find((pot) => pot.name === name)!.savedUsd;

describe('percent of money received', () => {
  it('saves a share of what arrives, and only once', async () => {
    const pot = await store.createPot(USER, { name: 'Trip', targetUsd: null });
    await store.addSaveRule(USER, { potId: pot.id, kind: 'percent_in', percent: 10, amountUsd: null, everyDays: null, nextRunAt: null });

    await runAutoSave(store, balanceOf); // first look only sets the baseline
    expect(await saved('Trip')).toBe('0');

    balance = parseUsd('150'); // $50 arrived
    await runAutoSave(store, balanceOf);
    expect(await saved('Trip')).toBe('5');

    await runAutoSave(store, balanceOf); // nothing new
    expect(await saved('Trip')).toBe('5');
  });

  it('does not count money going out and coming back as new money', async () => {
    const pot = await store.createPot(USER, { name: 'Trip', targetUsd: null });
    await store.addSaveRule(USER, { potId: pot.id, kind: 'percent_in', percent: 50, amountUsd: null, everyDays: null, nextRunAt: null });
    await runAutoSave(store, balanceOf);

    balance = parseUsd('60'); // sent $40
    await runAutoSave(store, balanceOf);
    balance = parseUsd('80'); // $20 arrived
    await runAutoSave(store, balanceOf);

    expect(await saved('Trip')).toBe('10');
  });
});

describe('recurring', () => {
  it('saves on schedule, and says so when there is not enough free', async () => {
    const pot = await store.createPot(USER, { name: 'Rainy day', targetUsd: null });
    const now = new Date();
    await store.addSaveRule(USER, { potId: pot.id, kind: 'recurring', percent: null, amountUsd: '150', everyDays: 7, nextRunAt: now.toISOString() });

    await runAutoSave(store, balanceOf, now);

    expect(await saved('Rainy day')).toBe('0');
    const notes = await store.listNotifications(USER);
    expect(notes[0]?.kind).toBe('auto_save');
  });
});

describe('sweep and goals', () => {
  it('keeps the floor free and stops at the goal', async () => {
    const pot = await store.createPot(USER, { name: 'Savings', targetUsd: '30' });
    await store.addSaveRule(USER, { potId: pot.id, kind: 'sweep_above', percent: null, amountUsd: '50', everyDays: null, nextRunAt: null });

    await runAutoSave(store, balanceOf);

    // $50 above the floor, but the goal is $30.
    expect(await saved('Savings')).toBe('30');
    expect((await store.listNotifications(USER)).some((note) => note.kind === 'pot_goal')).toBe(true);
  });

  it('never saves money another pot already holds', async () => {
    const holding = await store.createPot(USER, { name: 'Rent', targetUsd: null });
    await store.adjustPot(USER, holding.id, '90');
    const pot = await store.createPot(USER, { name: 'Fun', targetUsd: null });
    await store.addSaveRule(USER, { potId: pot.id, kind: 'sweep_above', percent: null, amountUsd: '0', everyDays: null, nextRunAt: null });

    await runAutoSave(store, balanceOf);

    expect(await saved('Fun')).toBe('10');
  });
});

describe('weekly check-in', () => {
  // A month-old account: new accounts get their first check-in after a week.
  beforeEach(async () => {
    await database.db.execute(sql`UPDATE users SET created_at = now() - interval '30 days'`);
  });

  it('skips a quiet week', async () => {
    expect(await runCheckIns(store)).toBe(0);
  });

  it('waits a week before the first one', async () => {
    await database.db.execute(sql`UPDATE users SET created_at = now()`);
    const pot = await store.createPot(USER, { name: 'Trip', targetUsd: '500' });
    await store.adjustPot(USER, pot.id, '20');

    expect(await runCheckIns(store)).toBe(0);
  });

  it('reports what auto-save did, then starts the count over', async () => {
    const pot = await store.createPot(USER, { name: 'Trip', targetUsd: '500' });
    const rule = await store.addSaveRule(USER, { potId: pot.id, kind: 'sweep_above', percent: null, amountUsd: '80', everyDays: null, nextRunAt: null });
    await runAutoSave(store, balanceOf);

    expect(await runCheckIns(store)).toBe(1);
    const [note] = await store.listNotifications(USER);
    expect(note?.kind).toBe('check_in');
    expect(note?.body).toContain('Auto-save put $20.00 aside');
    expect((await store.listSaveRules(USER)).find((r) => r.id === rule.id)?.savedSinceCheckInUsd).toBe('0');

    // Not again the same week.
    expect(await runCheckIns(store)).toBe(0);
  });

  it('counts money sent to people, not money moved between their own wallets', async () => {
    await landed(sent('25'));
    await landed(
      sent('500', {
        intentType: 'bridge',
        recipient: null,
        inflow: [{ token: { ...USDC_ARC, chainId: CHAIN.baseSepolia, address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e' }, amount: '0', displayAmount: '499.9', usdValue: '499.9' }],
      }),
    );

    expect(await runCheckIns(store)).toBe(1);
    const [note] = await store.listNotifications(USER);
    expect(note?.body).toContain('You sent $25.00.');
  });
});

const USDC_ARC = {
  chainId: CHAIN.arcTestnet,
  address: '0x3600000000000000000000000000000000000000',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUrl: null,
  verified: true,
} as const;

/** Just enough of a plan to categorise: a send of `usd` to @sam unless overridden. */
function sent(usd: string, over: Partial<Plan> = {}): Plan {
  return {
    id: crypto.randomUUID(),
    intentType: 'transfer',
    summary: `Send $${usd}.`,
    modelRationale: '',
    outflow: [{ token: USDC_ARC, amount: '0', displayAmount: usd, usdValue: usd }],
    inflow: [],
    recipient: { address: '0x2222222222222222222222222222222222222222', display: '@sam', ensName: null, contactLabel: null, known: true, isContract: false },
    fee: { totalUsd: '0.01', paidIn: 'usdc', breakdown: { networkUsd: '0.01', paymasterUsd: '0', serviceUsd: '0' } },
    warnings: [],
    calls: [],
    simulation: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...over,
  } as Plan;
}

/** A move that landed: its plan stored, its execution recorded and settled. */
async function landed(plan: Plan) {
  await store.putPlan(USER, plan, 'agent');
  const execution = await store.recordExecution(USER, {
    planId: plan.id,
    origin: 'agent',
    chainId: CHAIN.arcTestnet,
    txHash: `0x${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}`,
    counterparty: '0x2222222222222222222222222222222222222222',
    amount: plan.outflow[0]!.displayAmount,
    outflowUsd: plan.outflow[0]!.usdValue!,
    summary: plan.summary,
  });
  await store.settleExecution(execution.id, 'success');
}
