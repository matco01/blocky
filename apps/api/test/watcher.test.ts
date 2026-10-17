import { CHAIN, type Address, type Plan } from '@blocky/shared';
import { ARC_TRANSFER_EMITTER, TRANSFER_TOPIC, type ChainLog, type ChainReader, type LogFilter } from '@blocky/wallet-core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/client';
import { createStore, type Store } from '../src/store';
import {
  HISTORY_BLOCKS,
  LAG_BLOCKS,
  MAX_WATCH_BLOCKS,
  blockAt,
  readAllHistory,
  readHistory,
  receivedKey,
  walletTransfers,
  watchTransfers,
} from '../src/watcher';

/**
 * The chain watcher, against a real (embedded) Postgres and a pretend Arc:
 * blocks every half second, and whatever transfer logs a test puts in them.
 * What it must get right: every dollar that reaches a Blocky wallet is
 * recorded once and told once, and nothing else is.
 */

const ARC = CHAIN.arcTestnet;
const ALICE = { id: 'did:privy:alice', wallet: '0xa11ce00000000000000000000000000000000001' as Address };
const SAM = { id: 'did:privy:sam', wallet: '0x5a30000000000000000000000000000000000003' as Address };
const STRANGER = '0x9999999999999999999999999999999999999999' as Address;
const NOBODY = '0x7777777777777777777777777777777777777777' as Address;

const HEAD = 10_000;
const NOW = Date.parse('2026-10-17T12:00:00Z');
/** Block `n` was made half a second per block before `HEAD`, which is now. */
const timeOf = (n: number) => new Date(NOW - (HEAD - n) * 500);

let database: Database;
let store: Store;
let head: number;
let logs: ChainLog[];
let asked: LogFilter[];

const topic = (address: string) => `0x${address.slice(2).padStart(64, '0')}` as `0x${string}`;

/** A system Transfer on Arc: what a native or token USDC send leaves in a block. */
function transfer(block: number, from: Address, to: Address, dollars: string, index = 0, tx = `0x${block.toString(16).padStart(64, '0')}`): ChainLog {
  const [whole, fraction = ''] = dollars.split('.');
  const native = BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  return {
    address: ARC_TRANSFER_EMITTER,
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: `0x${native.toString(16).padStart(64, '0')}`,
    blockNumber: block,
    blockTimestamp: timeOf(block),
    transactionHash: tx as `0x${string}`,
    logIndex: index,
  };
}

const reader = {
  async blockNumber() {
    return head;
  },
  async blockTime(_chainId: number, n: number) {
    return timeOf(n);
  },
  async getLogs(_chainId: number, filter: LogFilter) {
    asked.push(filter);
    return logs.filter(
      (log) =>
        log.blockNumber >= filter.fromBlock &&
        log.blockNumber <= filter.toBlock &&
        filter.topics.every((want, i) => want === null || (Array.isArray(want) ? want.includes(log.topics[i]!) : want === log.topics[i])),
    );
  },
} as unknown as ChainReader;

const deps = () => ({ store, reader, chainId: ARC, now: () => new Date(NOW) });

async function join(user: { id: string; wallet: Address }, username?: string, createdAt?: Date) {
  await store.upsertUser({ id: user.id, walletAddress: user.wallet });
  if (username) await store.setUsername(user.id, username);
  if (createdAt) await database.db.execute(sql`UPDATE users SET created_at = ${createdAt.toISOString()} WHERE id = ${user.id}`);
}

/** Start the watcher where a test wants it, history already done. */
async function watchingFrom(block: number) {
  await store.startChainCursor(ARC, { block, historyNext: block + 1, historyTo: block }, new Date(NOW));
}

beforeAll(async () => {
  database = await openDatabase({});
  store = createStore(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`TRUNCATE chain_transfers, chain_cursors, executions, plans, users CASCADE`);
  head = HEAD;
  logs = [];
  asked = [];
  await join(ALICE, 'alice');
});

describe('the live edge', () => {
  it('records money reaching a Blocky wallet and tells them who sent it', async () => {
    await join(SAM, 'sam');
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 50, SAM.wallet, ALICE.wallet, '20')];

    await watchTransfers(deps());

    const { transfers } = await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW));
    expect(transfers).toMatchObject([{ from: SAM.wallet, to: ALICE.wallet, value: 20_000_000n }]);
    const [note] = await store.listNotifications(ALICE.id);
    expect(note).toMatchObject({ kind: 'money_received', title: '@sam sent you $20.00', body: 'It’s in your wallet.' });
    // Dated by its block, not by when the watcher got to it.
    expect(note!.createdAt).toBe(timeOf(HEAD - 50).toISOString());
  });

  it('names a sender the user saved as a contact, and an unknown one by address', async () => {
    await store.saveContact(ALICE.id, 'Mum', STRANGER);
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 60, STRANGER, ALICE.wallet, '5', 0), transfer(HEAD - 50, NOBODY, ALICE.wallet, '7.5', 0)];

    await watchTransfers(deps());

    const titles = (await store.listNotifications(ALICE.id)).map((n) => [n.title, n.body]);
    expect(titles).toContainEqual(['Mum sent you $5.00', 'It’s in your wallet.']);
    expect(titles).toContainEqual(['You received $7.50', 'From 0x7777…7777. It’s in your wallet.']);
  });

  it('calls money minted in from another chain an arrival, not a payment from 0x0000…', async () => {
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 50, '0x0000000000000000000000000000000000000000', ALICE.wallet, '50')];

    await watchTransfers(deps());

    expect((await store.listNotifications(ALICE.id))[0]?.title).toBe('$50.00 arrived from another network');
  });

  it('calls it the user’s own money when they just moved it here from another chain', async () => {
    await watchingFrom(HEAD - 100);
    const bridge = movePlan();
    await store.putPlan(ALICE.id, bridge, 'agent');
    await store.recordExecution(ALICE.id, {
      planId: bridge.id,
      origin: 'agent',
      chainId: CHAIN.baseSepolia,
      txHash: `0x${'b'.repeat(64)}`,
      counterparty: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
      amount: '19.98',
      outflowUsd: '20',
      summary: bridge.summary,
    });
    await database.db.execute(sql`UPDATE executions SET created_at = ${timeOf(HEAD - 200).toISOString()}`);
    // An Across relayer fills it: someone the user has never heard of.
    logs = [transfer(HEAD - 50, NOBODY, ALICE.wallet, '19.98')];

    await watchTransfers(deps());

    expect((await store.listNotifications(ALICE.id))[0]).toMatchObject({ title: 'Your $19.98 arrived', body: 'The money you moved is in your wallet.' });
  });

  it('a move made after the money landed doesn’t explain it', async () => {
    await watchingFrom(HEAD - 100);
    const bridge = movePlan();
    await store.putPlan(ALICE.id, bridge, 'agent');
    await store.recordExecution(ALICE.id, {
      planId: bridge.id,
      origin: 'agent',
      chainId: CHAIN.baseSepolia,
      txHash: `0x${'e'.repeat(64)}`,
      counterparty: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
      amount: '19.98',
      outflowUsd: '20',
      summary: bridge.summary,
    });
    await database.db.execute(sql`UPDATE executions SET created_at = ${new Date(NOW + 60 * 60_000).toISOString()}`);
    logs = [transfer(HEAD - 50, NOBODY, ALICE.wallet, '19.98')];

    await watchTransfers(deps());

    expect((await store.listNotifications(ALICE.id))[0]?.title).toBe('You received $19.98');
  });

  it('records what a Blocky wallet sent, and tells nobody about it', async () => {
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 50, ALICE.wallet, NOBODY, '3')];

    await watchTransfers(deps());

    const { transfers } = await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW));
    expect(transfers).toMatchObject([{ from: ALICE.wallet, to: NOBODY, value: 3_000_000n }]);
    expect(await store.listNotifications(ALICE.id)).toEqual([]);
  });

  it('keeps nothing that doesn’t touch a Blocky wallet', async () => {
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 50, STRANGER, NOBODY, '1000')];

    await watchTransfers(deps());

    expect((await walletTransfers(store, ARC, STRANGER, new Date(NOW))).transfers).toEqual([]);
  });

  it('doesn’t tell anyone about dust — it’s spam, or a poisoned look-alike address', async () => {
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 50, NOBODY, ALICE.wallet, '0.009')];

    await watchTransfers(deps());

    expect(await store.listNotifications(ALICE.id)).toEqual([]);
  });

  it('leaves a send made through Blocky to the sender’s own report, which knows the request it paid', async () => {
    await join(SAM, 'sam');
    await watchingFrom(HEAD - 100);
    const plan = movePlan({ intentType: 'transfer', inflow: [] });
    await store.putPlan(SAM.id, plan, 'manual');
    const tx = `0x${'c'.repeat(64)}`;
    await store.recordExecution(SAM.id, {
      planId: plan.id,
      origin: 'manual',
      chainId: ARC,
      txHash: tx,
      counterparty: ALICE.wallet,
      amount: '20',
      outflowUsd: '20',
      summary: plan.summary,
    });
    logs = [transfer(HEAD - 50, SAM.wallet, ALICE.wallet, '20', 0, tx)];

    await watchTransfers(deps());

    expect(await store.listNotifications(ALICE.id)).toEqual([]);
    // Still on record for the feed.
    expect((await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW))).transfers).toHaveLength(1);
  });

  it('says it once when the sender’s report got there first', async () => {
    await watchingFrom(HEAD - 100);
    const tx = `0x${'d'.repeat(64)}`;
    await store.notify(ALICE.id, { kind: 'request_paid', title: '@sam paid your request', body: '$20.00', key: receivedKey(tx) });
    logs = [transfer(HEAD - 50, SAM.wallet, ALICE.wallet, '20', 0, tx)];

    await watchTransfers(deps());

    expect((await store.listNotifications(ALICE.id)).map((n) => n.title)).toEqual(['@sam paid your request']);
  });

  it('reading the same blocks again stores nothing twice and tells nobody twice', async () => {
    await watchingFrom(HEAD - 100);
    logs = [transfer(HEAD - 50, NOBODY, ALICE.wallet, '20')];

    await watchTransfers(deps());
    // As if the cursor never moved: a crash between storing and saving the position.
    await database.db.execute(sql`UPDATE chain_cursors SET block = ${HEAD - 100}`);
    await watchTransfers(deps());

    expect((await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW))).transfers).toHaveLength(1);
    expect(await store.listNotifications(ALICE.id)).toHaveLength(1);
  });

  it('stays a few blocks behind the newest, and moves its position to what it read', async () => {
    await watchingFrom(HEAD - 100);

    await watchTransfers(deps());

    expect(asked.at(-1)).toMatchObject({ fromBlock: HEAD - 99, toBlock: HEAD - LAG_BLOCKS });
    expect((await store.getChainCursor(ARC))?.block).toBe(HEAD - LAG_BLOCKS);
  });

  it('catches up after downtime in steps, not one giant query', async () => {
    await watchingFrom(HEAD - 3 * MAX_WATCH_BLOCKS);

    await watchTransfers(deps());

    expect((await store.getChainCursor(ARC))?.block).toBe(HEAD - 2 * MAX_WATCH_BLOCKS);
  });

  it('asks the chain for every transfer, so a wallet that joined a second ago is never missed', async () => {
    await watchingFrom(HEAD - 100);
    await watchTransfers(deps());

    expect(asked[0]!.address).toBe(ARC_TRANSFER_EMITTER);
    expect(asked[0]!.topics).toEqual([TRANSFER_TOPIC]);
  });
});

describe('the first start', () => {
  it('with no accounts yet, has no history to read', async () => {
    await database.db.execute(sql`TRUNCATE users CASCADE`);

    await watchTransfers(deps());

    const cursor = await store.getChainCursor(ARC);
    expect(cursor).toMatchObject({ block: HEAD - LAG_BLOCKS, historyTo: HEAD - LAG_BLOCKS });
    expect(cursor!.historyNext).toBeGreaterThan(cursor!.historyTo);
  });

  it('reads history from the block the oldest account was made, an hour early', async () => {
    // Alice joined 2,000 seconds ago: 4,000 blocks back.
    await database.db.execute(sql`UPDATE users SET created_at = ${timeOf(HEAD - 4_000).toISOString()}`);

    await watchTransfers(deps());

    const cursor = await store.getChainCursor(ARC);
    // An hour is 7,200 blocks; before block 0 there is nothing.
    expect(cursor).toMatchObject({ historyNext: 0, historyTo: HEAD - LAG_BLOCKS, block: HEAD - LAG_BLOCKS });
  });

  it('finds a block by its time', async () => {
    expect(await blockAt(reader, ARC, HEAD, timeOf(1234))).toBe(1234);
    expect(await blockAt(reader, ARC, HEAD, new Date(timeOf(1234).getTime() + 250))).toBe(1234);
    expect(await blockAt(reader, ARC, HEAD, new Date(NOW + 60_000))).toBe(HEAD);
  });
});

describe('history', () => {
  it('reads back to the oldest account, for Blocky’s wallets only, and tells nobody', async () => {
    await join(SAM, 'sam');
    await store.startChainCursor(ARC, { block: 9_000, historyNext: 1_000, historyTo: 9_000 }, new Date(NOW));
    logs = [
      transfer(1_500, NOBODY, ALICE.wallet, '20', 0),
      transfer(6_200, SAM.wallet, ALICE.wallet, '5', 0),
      transfer(8_999, ALICE.wallet, STRANGER, '1', 0),
      transfer(7_000, STRANGER, NOBODY, '99', 0),
    ];

    const states: string[] = [];
    for (let i = 0; i < 5 && states.at(-1) !== 'done'; i++) states.push(await readHistory(deps()));

    expect(states).toEqual(['reading', 'done']);
    const { transfers, complete } = await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW));
    expect(transfers.map((t) => t.value)).toEqual([1_000_000n, 5_000_000n, 20_000_000n]);
    expect(complete).toBe(true);
    // Between two Blocky users, found by both queries — stored once.
    expect((await walletTransfers(store, ARC, SAM.wallet, new Date(NOW))).transfers).toHaveLength(1);
    expect(await store.listNotifications(ALICE.id)).toEqual([]);
    // Filtered to the wallets, a window at a time.
    expect(asked.every((filter) => filter.topics.length > 1 && filter.toBlock - filter.fromBlock < HISTORY_BLOCKS)).toBe(true);
  });

  it('waits for the live edge to say where history ends', async () => {
    expect(await readHistory(deps())).toBe('waiting');
  });

  it('keeps going through an endpoint’s bad moments until it’s done', async () => {
    await store.startChainCursor(ARC, { block: 9_000, historyNext: 1_000, historyTo: 9_000 }, new Date(NOW));
    logs = [transfer(7_500, NOBODY, ALICE.wallet, '4', 0)];
    let refusals = 1;
    const flaky = {
      ...reader,
      async getLogs(chainId: number, filter: LogFilter) {
        if (refusals-- > 0) throw new Error('rate limit exceeded');
        return reader.getLogs(chainId as never, filter);
      },
    } as ChainReader;
    const errors: unknown[] = [];

    await readAllHistory({ store, reader: flaky, chainId: ARC }, { pauseMs: 0, onError: (error) => errors.push(error) });

    expect(errors).toHaveLength(1);
    expect((await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW))).transfers).toHaveLength(1);
    expect((await store.getChainCursor(ARC))!.historyNext).toBe(9_001);
  });

  it('the feed says it may be missing something until history is read', async () => {
    await store.startChainCursor(ARC, { block: 9_000, historyNext: 1_000, historyTo: 9_000 }, new Date(NOW));

    expect((await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW))).complete).toBe(false);
  });

  it('and when the live edge hasn’t read the chain in a while', async () => {
    await watchingFrom(HEAD - 100);

    expect((await walletTransfers(store, ARC, ALICE.wallet, new Date(NOW + 5 * 60_000))).complete).toBe(false);
  });
});

/** A plan that moved money between chains — by default from Base Sepolia to Arc. */
function movePlan(over: Partial<Plan> = {}): Plan {
  const usdc = (chainId: number) => ({
    chainId,
    address: '0x3600000000000000000000000000000000000000' as Address,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUrl: null,
    verified: true,
  });
  return {
    id: crypto.randomUUID(),
    intentType: 'bridge',
    summary: 'Move $20 to Arc.',
    modelRationale: 'Bring it home.',
    outflow: [{ token: usdc(CHAIN.baseSepolia) as never, amount: '20000000', displayAmount: '20', usdValue: '20' }],
    inflow: [{ token: usdc(ARC) as never, amount: '19980000', displayAmount: '19.98', usdValue: '19.98' }],
    recipient: null,
    fee: { totalUsd: '0.02', paidIn: 'usdc', breakdown: { networkUsd: '0.02', paymasterUsd: '0', serviceUsd: '0' } },
    warnings: [],
    calls: [],
    simulation: null,
    createdAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    ...over,
  } as Plan;
}
