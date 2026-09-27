import { IntentSchema } from '@blocky/shared';
import type { ExplorerTransfer } from '../src/activity';
import { agentToolsFor, destinationMismatch } from '../src/agent';
import { openDatabase, type Database } from '../src/db/client';
import { createStore, type Store } from '../src/store';
import type { ChainReader } from '@blocky/wallet-core';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `agentToolsFor`'s real bodies, against a real (embedded) Postgres and a
 * faked chain. Not the loop — that is `packages/agent`'s job — just whether
 * each tool does the thing its description promises.
 */

const USER = 'did:privy:alice';
const ACCOUNT = '0xa11ce00000000000000000000000000000000001';
const VITALIK_ETH_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

let database: Database;
let store: Store;
let ensResolutions: Record<string, string | null>;
let ensNames: Record<string, string | null>;
let transfers: () => Promise<ExplorerTransfer[]>;

const reader: ChainReader = {
  supports: () => true,
  async erc20Balance() {
    return 0n;
  },
  async nativeBalance() {
    return 0n;
  },
  async tokenMetadata() {
    return null;
  },
  async isContract() {
    return false;
  },
  async gasPrice() {
    return 0n;
  },
  async transactionReceipt() {
    return null;
  },
  async resolveEns(name) {
    return (ensResolutions[name] ?? null) as `0x${string}` | null;
  },
  async lookupEns(address) {
    return ensNames[address] ?? null;
  },
};

function tools() {
  return agentToolsFor(store, USER, reader, ACCOUNT, () => transfers());
}

beforeAll(async () => {
  database = await openDatabase({});
  store = createStore(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`TRUNCATE executions, plans, sessions, contacts, policies, users CASCADE`);
  await store.upsertUser({ id: USER, walletAddress: ACCOUNT });
  ensResolutions = { 'vitalik.eth': VITALIK_ETH_ADDRESS };
  ensNames = {};
  transfers = async () => [];
});

describe('get_token_price', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers a well-known symbol with the live feed’s price, faked rather than hit for real', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ coins: { 'coingecko:ethereum': { price: 2628.32, symbol: 'ETH', timestamp: 1, confidence: 0.99 } } }),
        ),
      ),
    );

    const result = (await tools().getTokenPrice('eth')) as { symbol?: string; usd?: number; error?: string };

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ symbol: 'ETH', usd: 2628.32 });
  });

  it('answers a symbol we do not curate with an explicit error, not a guess — and makes no request at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = (await tools().getTokenPrice('NOTATOKEN')) as { error?: string };

    expect(result.error).toMatch(/no price/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns an actual feed failure into "temporarily unavailable", not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));

    const result = (await tools().getTokenPrice('ETH')) as { error?: string };

    expect(result.error).toMatch(/unavailable/i);
  });
});

describe('get_arc_ecosystem', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers with the live feed’s protocol list, faked rather than hit for real', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { name: 'Morpho Blue', category: 'Lending', chains: ['Ethereum', 'Arc'], chainTvls: { Arc: 184_000_000 } },
            { name: 'Some Ethereum Thing', category: 'Dexs', chains: ['Ethereum'], chainTvls: { Ethereum: 1 } },
          ]),
        ),
      ),
    );

    const result = (await tools().getArcEcosystem()) as { protocols?: Array<{ name: string }>; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.protocols).toEqual([{ name: 'Morpho Blue', category: 'Lending', tvlUsd: 184_000_000 }]);
  });

  it('turns an actual feed failure into "temporarily unavailable", not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 503 })));

    const result = (await tools().getArcEcosystem()) as { error?: string };

    expect(result.error).toMatch(/unavailable/i);
  });
});

describe('resolve_address', () => {
  it('passes an already-valid address straight through, lowercased', async () => {
    const result = await tools().resolveAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01');

    expect(result).toEqual({ address: '0xabcdef0123456789abcdef0123456789abcdef01', ensName: null });
  });

  it('attaches a reverse ENS name when one exists', async () => {
    ensNames[VITALIK_ETH_ADDRESS] = 'vitalik.eth';

    const result = await tools().resolveAddress(VITALIK_ETH_ADDRESS);

    expect(result).toEqual({ address: VITALIK_ETH_ADDRESS, ensName: 'vitalik.eth' });
  });

  it('resolves an ENS name to its address', async () => {
    const result = await tools().resolveAddress('vitalik.eth');

    expect(result).toEqual({ address: VITALIK_ETH_ADDRESS, ensName: 'vitalik.eth' });
  });

  it('reports an unresolvable ENS name as a question, never a guessed address', async () => {
    const result = (await tools().resolveAddress('doesnotexist.eth')) as { error?: string };

    expect(result.error).toMatch(/could not resolve/i);
  });

  it('refuses anything that is neither an address nor an ENS name', async () => {
    const result = (await tools().resolveAddress('Sam')) as { error?: string };

    expect(result.error).toBeDefined();
  });
});

describe('save_contact and delete_contact', () => {
  it('saves a valid address under a label', async () => {
    const result = await tools().saveContact('Sam', '0x1111111111111111111111111111111111111111');

    expect(result).toEqual({ saved: true, label: 'Sam', address: '0x1111111111111111111111111111111111111111' });
    expect(await store.findContact(USER, 'sam')).toEqual({
      label: 'Sam',
      address: '0x1111111111111111111111111111111111111111',
    });
  });

  /** The model cannot smuggle a non-address destination into the contact book. */
  it('refuses a non-address, and saves nothing', async () => {
    const result = (await tools().saveContact('Sam', 'sam.eth')) as { error?: string };

    expect(result.error).toBeDefined();
    expect(await store.findContact(USER, 'sam')).toBeNull();
  });

  it('saving a contact never touches the send-unattended allowlist', async () => {
    await tools().saveContact('Sam', '0x1111111111111111111111111111111111111111');

    expect(await store.isKnownRecipient(USER, '0x1111111111111111111111111111111111111111')).toBe(false);
  });

  it('deletes a saved contact and reports whether anything was removed', async () => {
    await store.saveContact(USER, 'Sam', '0x1111111111111111111111111111111111111111');

    expect(await tools().deleteContact('Sam')).toEqual({ deleted: true });
    expect(await tools().deleteContact('Sam')).toEqual({ deleted: false });
  });

  it('only ever touches the calling user’s own contacts', async () => {
    await store.upsertUser({ id: 'did:privy:mallory', walletAddress: '0x2222222222222222222222222222222222222222' });
    await store.saveContact('did:privy:mallory', 'Sam', '0x9999999999999999999999999999999999999999');

    await tools().saveContact('Sam', '0x1111111111111111111111111111111111111111');

    expect(await store.findContact('did:privy:mallory', 'Sam')).toEqual({
      label: 'Sam',
      address: '0x9999999999999999999999999999999999999999',
    });
  });
});

describe('get_recent_activity', () => {
  it('reuses the same merge the Activity screen renders, so the two can never disagree', async () => {
    const plan = {
      id: crypto.randomUUID(),
      intentType: 'transfer' as const,
      summary: 'Send 10 USDC',
      modelRationale: 'Asked to pay Sam.',
      outflow: [],
      inflow: [],
      recipient: null,
      fee: { totalUsd: '0.01', paidIn: 'usdc' as const, breakdown: { networkUsd: '0.01', paymasterUsd: '0', serviceUsd: '0' } },
      warnings: [],
      calls: [{ chainId: 5042002 as const, to: '0x3600000000000000000000000000000000000000' as const, data: '0xa9059cbb' as const, value: '0', description: 'Transfer' }],
      simulation: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await store.putPlan(USER, plan, 'agent');
    await store.recordExecution(USER, {
      planId: plan.id,
      origin: 'agent',
      chainId: 5042002,
      txHash: `0x${'a'.repeat(64)}`,
      counterparty: '0x1111111111111111111111111111111111111111',
      amount: '10',
      outflowUsd: '10.01',
      summary: plan.summary,
    });

    const result = (await tools().getRecentActivity()) as { items: unknown[]; complete: boolean };

    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('marks the answer incomplete when the explorer is down, rather than claiming an empty history', async () => {
    transfers = async () => {
      throw new Error('explorer down');
    };

    const result = (await tools().getRecentActivity()) as { complete: boolean };

    expect(result.complete).toBe(false);
  });
});

describe('destination sanity', () => {
  const bridge = (toChainId: number, rationale: string) =>
    IntentSchema.parse({ type: 'bridge', token: { kind: 'symbol', symbol: 'USDC' }, amount: { kind: 'max' }, toChainId, rationale });

  it.each([
    ['says Arc, set Ethereum', 1, 'Sell Apple shares on Robinhood Chain back to USDC on Arc'],
    ['says home, set Ethereum', 1, 'Bring USDC on Arbitrum home'],
    ['says Arc, set Arbitrum', 42161, 'Move the Robinhood ETH back to Arc'],
  ])('refuses a proposal that %s', (_, toChainId, rationale) => {
    expect(destinationMismatch(bridge(toChainId, rationale))).toMatch(/One of them is wrong/);
  });

  it.each([
    ['the destination it names', 5042, 'Move all ETH on Arbitrum back to Arc as USDC'],
    ['a buy on the chain it names', 4663, 'Buy $1 of Apple stock on Robinhood Chain'],
    ['a rationale that names no chain', 8453, 'Move my dollars as asked'],
    ['"base" as an ordinary word', 42161, 'Move the base amount to Arbitrum'],
  ])('lets through %s', (_, toChainId, rationale) => {
    expect(destinationMismatch(bridge(toChainId, rationale))).toBeNull();
  });
});

describe('what Blocky can see and do in the app', () => {
  it('knows the user\'s own name and address', async () => {
    await store.setUsername(USER, 'olimufa');

    expect(await tools().getProfile()).toMatchObject({ username: 'olimufa', walletAddress: ACCOUNT });
  });

  it('reads the notification inbox', async () => {
    await store.notify(USER, { kind: 'money_received', title: '@sam sent you $5.00', body: 'It’s in your wallet.' });

    expect(await tools().getNotifications()).toMatchObject({ unread: 1, items: [{ title: '@sam sent you $5.00', read: false }] });
  });

  it('lowers spending limits, and never raises them from a chat', async () => {
    const before = await store.getPolicy(USER);

    const lowered = (await tools().lowerSpendingLimits({ perSendUsd: '$50', perDayUsd: null })) as Record<string, unknown>;
    expect(lowered).toMatchObject({ perSendUsd: '50', perDayUsd: before.dailyCapUsd });
    expect((await store.getPolicy(USER)).perTxCapUsd).toBe('50');

    const raised = (await tools().lowerSpendingLimits({ perSendUsd: '5000', perDayUsd: null })) as Record<string, unknown>;
    expect(raised.notRaised).toMatch(/Spending limits screen/);
    expect((await store.getPolicy(USER)).perTxCapUsd).toBe('50');
  });

  it('deletes a pot by name, leaving the money where it is', async () => {
    await store.createPot(USER, { name: 'Trip', targetUsd: null });

    expect(await tools().deletePot('trip')).toMatchObject({ deleted: 'Trip' });
    expect(await store.listPots(USER)).toEqual([]);
  });
});
