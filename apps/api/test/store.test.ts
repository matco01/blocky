import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POLICY, type Plan } from '@blocky/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/client';
import { policies } from '../src/db/schema';
import { DuplicateExecutionError, createStore, type Store } from '../src/store';

/**
 * Run against real Postgres semantics (PGlite), not a mock. The daily cap is a
 * SQL sum over `numeric` columns; the only honest test of it is a database.
 */

const USER = 'did:privy:alice';
const OTHER = 'did:privy:mallory';
const WALLET = '0x1111111111111111111111111111111111111111' as const;
const SAM = '0x2222222222222222222222222222222222222222' as const;

function plan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    intentType: 'transfer',
    summary: 'Send 10 USDC to Sam.',
    modelRationale: 'Asked to pay Sam.',
    outflow: [],
    inflow: [],
    recipient: null,
    fee: {
      totalUsd: '0.01',
      paidIn: 'usdc',
      breakdown: { networkUsd: '0.01', paymasterUsd: '0', serviceUsd: '0' },
    },
    warnings: [],
    calls: [
      {
        chainId: 5042002,
        to: '0x3600000000000000000000000000000000000000',
        data: '0xa9059cbb',
        value: '0',
        description: 'Transfer',
      },
    ],
    simulation: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

let database: Database;
let store: Store;

// One embedded Postgres per file, emptied between tests. Booting one per test
// costs a second each, and a slow suite is a suite people stop running.
beforeAll(async () => {
  database = await openDatabase({});
  store = createStore(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(
    sql`TRUNCATE executions, plans, sessions, contacts, policies, users RESTART IDENTITY CASCADE`,
  );
  await store.upsertUser({ id: USER, walletAddress: WALLET });
  await store.upsertUser({ id: OTHER, walletAddress: SAM });
});

/** Store a plan and record an execution of it in one step. */
async function execute(
  outflowUsd: string,
  opts: { origin?: 'agent' | 'manual'; user?: string } = {},
) {
  const user = opts.user ?? USER;
  const origin = opts.origin ?? 'agent';
  const p = plan();

  await store.putPlan(user, p, origin);

  return store.recordExecution(user, {
    planId: p.id,
    origin,
    chainId: 5042002,
    txHash: `0x${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}`,
    counterparty: SAM,
    amount: outflowUsd,
    outflowUsd,
    summary: p.summary,
  });
}

describe('the daily cap sum', () => {
  it('is zero for a user with no history', async () => {
    expect(await store.spentTodayUsd(USER)).toBe('0');
  });

  it('adds exactly, with no float drift', async () => {
    await execute('0.1');
    await execute('0.2');

    expect(await store.spentTodayUsd(USER)).toBe('0.3');
  });

  it('counts pending executions, so quick repeats cannot both slip under the cap', async () => {
    await execute('20');

    expect(await store.spentTodayUsd(USER)).toBe('20');
  });

  it('stops counting an execution that reverted — nothing left the wallet', async () => {
    const reverted = await execute('20');
    await execute('5');

    await store.settleExecution(reverted.id, 'reverted');

    expect(await store.spentTodayUsd(USER)).toBe('5');
  });

  it('ignores manual sends, which the cap does not govern', async () => {
    await execute('100', { origin: 'manual' });
    await execute('3');

    expect(await store.spentTodayUsd(USER)).toBe('3');
  });

  it('rolls off after 24 hours', async () => {
    await execute('50');
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);

    expect(await store.spentTodayUsd(USER, tomorrow)).toBe('0');
  });

  it('never counts another user’s spend', async () => {
    await execute('75', { user: OTHER });

    expect(await store.spentTodayUsd(USER)).toBe('0');
  });
});

describe('executions', () => {
  it('runs a plan at most once', async () => {
    const p = plan();
    await store.putPlan(USER, p, 'agent');

    const base = { planId: p.id, origin: 'agent' as const, chainId: 5042002 as const, counterparty: SAM, amount: '1', outflowUsd: '1', summary: 's' };

    await store.recordExecution(USER, { ...base, txHash: `0x${'a'.repeat(64)}` });

    await expect(
      store.recordExecution(USER, { ...base, txHash: `0x${'b'.repeat(64)}` }),
    ).rejects.toBeInstanceOf(DuplicateExecutionError);
  });

  it('settles a pending execution once, and never re-settles history', async () => {
    const execution = await execute('1');

    await store.settleExecution(execution.id, 'success');
    await store.settleExecution(execution.id, 'reverted');

    expect((await store.getExecution(USER, execution.id))?.status).toBe('success');
  });

  it('lists newest first, scoped to the user', async () => {
    await execute('1');
    await execute('2');
    await execute('9', { user: OTHER });

    const list = await store.listExecutions(USER);

    expect(list.map((e) => e.outflowUsd)).toEqual(['2', '1']);
  });

  it('will not hand one user’s plan to another', async () => {
    const p = plan();
    await store.putPlan(USER, p, 'agent');

    expect(await store.getPlan(OTHER, p.id)).toBeNull();
    expect((await store.getPlan(USER, p.id))?.origin).toBe('agent');
  });
});

describe('policy', () => {
  it('defaults conservatively', async () => {
    expect(await store.getPolicy(USER)).toEqual(DEFAULT_POLICY);
  });

  it('round-trips', async () => {
    const next = { ...DEFAULT_POLICY, enabled: true, dailyCapUsd: '500' };
    await store.setPolicy(USER, next);

    expect(await store.getPolicy(USER)).toEqual(next);
  });

  it('falls back to the default when the stored policy no longer parses', async () => {
    await database.db.insert(policies).values({ userId: USER, policy: { enabled: 'yes please' } });

    expect(await store.getPolicy(USER)).toEqual(DEFAULT_POLICY);
  });

  it('allowlists recipients case-insensitively, without duplicates', async () => {
    const checksummed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01' as const;

    await store.addKnownRecipient(USER, checksummed);
    await store.addKnownRecipient(USER, checksummed.toLowerCase() as typeof checksummed);

    expect(await store.isKnownRecipient(USER, checksummed)).toBe(true);
    expect((await store.getPolicy(USER)).recipientAllowlist).toHaveLength(1);
  });
});

describe('sessions', () => {
  const permissions = (validUntil: number) => ({
    chainId: 5042002 as const,
    signerAddress: SAM,
    calls: [{ target: '0x3600000000000000000000000000000000000000' as const, selectors: ['0xa9059cbb'] }],
    spendLimits: [{ token: '0x3600000000000000000000000000000000000000' as const, limit: 250_000_000n }],
    validUntil,
  });

  const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

  it('round-trips bigint spend limits exactly', async () => {
    await store.putSession(USER, {
      id: crypto.randomUUID(),
      permissions: permissions(inAnHour()),
      createdAt: new Date(),
      revokedAt: null,
    });

    const active = await store.activeSession(USER, 5042002);

    expect(active?.permissions.spendLimits[0]?.limit).toBe(250_000_000n);
  });

  it('revokes every active session and never resurrects them', async () => {
    for (let i = 0; i < 2; i++) {
      await store.putSession(USER, {
        id: crypto.randomUUID(),
        permissions: permissions(inAnHour()),
        createdAt: new Date(),
        revokedAt: null,
      });
    }

    expect(await store.revokeSessions(USER)).toBe(2);
    expect(await store.activeSession(USER, 5042002)).toBeNull();
    expect(await store.revokeSessions(USER)).toBe(0);
  });

  it('treats an expired session as inactive', async () => {
    await store.putSession(USER, {
      id: crypto.randomUUID(),
      permissions: permissions(Math.floor(Date.now() / 1000) - 1),
      createdAt: new Date(),
      revokedAt: null,
    });

    expect(await store.activeSession(USER, 5042002)).toBeNull();
  });
});

describe('contacts', () => {
  it('matches labels regardless of case and whitespace, keeping the label as typed', async () => {
    await store.saveContact(USER, '  Sam ', SAM);

    expect(await store.findContact(USER, 'sam')).toEqual({ label: 'Sam', address: SAM });
  });

  it('updates rather than duplicates', async () => {
    await store.saveContact(USER, 'Sam', SAM);
    await store.saveContact(USER, 'SAM', WALLET);

    expect(await store.listContacts(USER)).toEqual([{ label: 'SAM', address: WALLET }]);
  });

  it('deletes, and reports whether anything was deleted', async () => {
    await store.saveContact(USER, 'Sam', SAM);

    expect(await store.deleteContact(USER, 'sam')).toBe(true);
    expect(await store.deleteContact(USER, 'sam')).toBe(false);
  });
});

/**
 * The reason this milestone exists. The old in-memory store forgot today's
 * spend on every restart, which quietly reset the daily cap to zero.
 */
describe('surviving a restart', () => {
  it('still knows today’s spend after the database is closed and reopened', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blocky-store-'));
    // A nested path that does not exist yet, as on a fresh clone with no
    // `.data/` directory. This exact case crashed the first real boot.
    const dir = join(root, '.data', 'pglite');

    try {
      const first = await openDatabase({ dataDir: dir });
      const s1 = createStore(first.db);
      await s1.upsertUser({ id: USER, walletAddress: WALLET });

      const p = plan();
      await s1.putPlan(USER, p, 'agent');
      await s1.recordExecution(USER, {
        planId: p.id,
        origin: 'agent',
        chainId: 5042002,
        txHash: `0x${'c'.repeat(64)}`,
        counterparty: SAM,
        amount: '42.5',
        outflowUsd: '42.5',
        summary: p.summary,
      });
      await first.close();

      const second = await openDatabase({ dataDir: dir });
      const s2 = createStore(second.db);

      expect(await s2.spentTodayUsd(USER)).toBe('42.5');
      await second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    // Two cold starts of embedded Postgres from disk: about 4s alone, and past
    // the 5s default when the whole suite runs at once.
  }, 30_000);
});

describe('memories', () => {
  it('remembers notes, refuses repeats, and forgets on request', async () => {
    await store.upsertUser({ id: 'did:privy:mem', walletAddress: '0x000000000000000000000000000000000000beef' });

    expect(await store.addMemory('did:privy:mem', '  Keeps about $50 on Arc. ')).toEqual({ saved: true });
    expect((await store.addMemory('did:privy:mem', 'keeps about $50 on arc.')).saved).toBe(false);

    const [memory] = await store.listMemories('did:privy:mem');
    expect(memory?.note).toBe('Keeps about $50 on Arc.');

    expect(await store.forgetMemory('did:privy:mem', memory!.id)).toBe(true);
    expect(await store.listMemories('did:privy:mem')).toEqual([]);
  });

  it('keeps each user’s notes to themselves', async () => {
    await store.upsertUser({ id: 'did:privy:a', walletAddress: '0x000000000000000000000000000000000000000a' });
    await store.upsertUser({ id: 'did:privy:b', walletAddress: '0x000000000000000000000000000000000000000b' });
    await store.addMemory('did:privy:a', 'Likes Apple.');
    const [note] = await store.listMemories('did:privy:a');

    expect(await store.listMemories('did:privy:b')).toEqual([]);
    expect(await store.forgetMemory('did:privy:b', note!.id)).toBe(false);
  });
});
