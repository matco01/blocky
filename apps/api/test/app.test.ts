import { buildPlan } from '@blocky/planner';
import { CHAIN, IntentSchema, planOutflowUsd, type Address, type Plan } from '@blocky/shared';
import {
  CCTP_FORWARD_HOOK_DATA,
  DEPOSIT_FOR_BURN_TOPIC,
  TRANSFER_TOPIC,
  cctpContracts,
  type ChainReader,
  type Receipt,
} from '@blocky/wallet-core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkPriceAlerts } from '../src/alerts';
import { createApp, type AppDeps } from '../src/app';
import type { IdentityProvider } from '../src/auth';
import { openDatabase, type Database } from '../src/db/client';
import { createStore, type Store } from '../src/store';

/**
 * The HTTP surface, end to end, against a real (embedded) Postgres. Privy, the
 * chain and the explorer are faked — each fake is the smallest thing that lets
 * a test state exactly the condition it is about.
 */

const USDC = '0x3600000000000000000000000000000000000000';
const ALICE_WALLET = '0xa11ce00000000000000000000000000000000001';
const MALLORY_WALLET = '0x3a11040000000000000000000000000000000002';
const SAM = '0x5a30000000000000000000000000000000000003';

const TOKENS: Record<string, { userId: string; wallet: string | null }> = {
  'alice-token': { userId: 'did:privy:alice', wallet: ALICE_WALLET },
  'mallory-token': { userId: 'did:privy:mallory', wallet: MALLORY_WALLET },
  'newbie-token': { userId: 'did:privy:newbie', wallet: null },
};

let database: Database;
let store: Store;
let walletLookups: number;

let chain: {
  balance: bigint | Error;
  receipts: Map<string, Receipt>;
};
let gateway: () => Promise<{ totalUsd: string; perChain: [] }>;
let explorer: () => Promise<[]>;
let agent: AppDeps['agent'];

const identity: IdentityProvider = {
  async verifyAccessToken(token) {
    return TOKENS[token]?.userId ?? null;
  },
  async embeddedWalletAddress(userId) {
    walletLookups++;
    return (Object.values(TOKENS).find((t) => t.userId === userId)?.wallet ?? null) as `0x${string}` | null;
  },
};

const reader: ChainReader = {
  supports: () => true,
  async erc20Balance() {
    if (chain.balance instanceof Error) throw chain.balance;
    return chain.balance;
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
    // ~2e10 native (18-decimal USDC) per gas, as observed on Arc testnet.
    return 20_000_000_000n;
  },
  async transactionReceipt(_chainId, hash) {
    return chain.receipts.get(hash) ?? null;
  },
  async resolveEns() {
    return null;
  },
  async lookupEns() {
    return null;
  },
};

function app() {
  const deps: AppDeps = {
    store,
    reader,
    identity,
    agent,
    gatewayBalances: () => gateway(),
    walletHoldings: async () => [],
    explorerTransfers: () => explorer(),
    receiptPolling: { attempts: 1, delayMs: 0 },
  };
  return createApp(deps);
}

async function call(path: string, init: { token?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  const response = await app().request(path, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  return { status: response.status, body: (await response.json()) as any };
}

function transferReceipt(from: string, to: string, amount: bigint): Receipt {
  const topic = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
  return {
    status: 'success',
    logs: [{ address: USDC, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: `0x${amount.toString(16).padStart(64, '0')}` }],
  };
}

const hash = (char: string) => `0x${char.repeat(64)}`;

async function planSend(amount = '10', token = 'alice-token'): Promise<Plan> {
  const { status, body } = await call('/v1/plans', {
    token,
    method: 'POST',
    body: { recipient: { kind: 'address', address: SAM }, amount: { kind: 'token', value: amount } },
  });
  expect(status).toBe(201);
  return body.plan as Plan;
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
  walletLookups = 0;
  chain = { balance: 100_000_000n, receipts: new Map() };
  gateway = async () => ({ totalUsd: '0', perChain: [] });
  explorer = async () => [];
  agent = null;
});

describe('authentication', () => {
  it('rejects a request with no token', async () => {
    expect((await call('/v1/me')).status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    expect((await call('/v1/me', { token: 'forged' })).status).toBe(401);
  });

  /** The M0 scheme trusted this header outright. It must now mean nothing. */
  it('ignores the old x-blocky-user header entirely', async () => {
    const { status } = await call('/v1/me', { headers: { 'x-blocky-user': 'did:privy:alice' } });

    expect(status).toBe(401);
  });

  it('takes the wallet from Privy, never from the client', async () => {
    const { body } = await call('/v1/me', {
      token: 'alice-token',
      headers: { 'x-wallet-address': MALLORY_WALLET },
    });

    expect(body.walletAddress).toBe(ALICE_WALLET);
  });

  it('looks the wallet up once, then caches it', async () => {
    await call('/v1/me', { token: 'alice-token' });
    await call('/v1/me', { token: 'alice-token' });

    expect(walletLookups).toBe(1);
  });

  it('asks the app to wait while the wallet is still being created', async () => {
    const { status, body } = await call('/v1/balance', { token: 'newbie-token' });

    expect(status).toBe(409);
    expect(body.error).toBe('wallet_not_ready');
  });
});

describe('balance', () => {
  it('reports the spendable Arc balance at 6 decimals', async () => {
    const { body } = await call('/v1/balance', { token: 'alice-token' });

    expect(body.totalUsd).toBe('100');
    expect(body.chainId).toBe(5042002);
  });

  it('keeps Gateway deposits out of the spendable total', async () => {
    gateway = async () => ({ totalUsd: '50', perChain: [] });

    const { body } = await call('/v1/balance', { token: 'alice-token' });

    expect(body.totalUsd).toBe('100');
    expect(body.gateway.totalUsd).toBe('50');
  });

  it('still answers when Gateway is down, and says so', async () => {
    gateway = async () => {
      throw new Error('down');
    };

    const { status, body } = await call('/v1/balance', { token: 'alice-token' });

    expect(status).toBe(200);
    expect(body.gateway).toBeNull();
  });

  it('returns 503, never a zero, when the chain cannot be read', async () => {
    chain.balance = new Error('rpc down');

    const { status, body } = await call('/v1/balance', { token: 'alice-token' });

    expect(status).toBe(503);
    expect(body.totalUsd).toBeUndefined();
  });
});

describe('manual send planning', () => {
  it('plans an Arc transfer whose fee is paid in USDC', async () => {
    const plan = await planSend('10');

    expect(plan.calls[0]?.chainId).toBe(5042002);
    expect(plan.fee.paidIn).toBe('usdc');
    expect(plan.outflow[0]?.amount).toBe('10000000');
  });

  it('refuses to plan the whole balance with nothing left for the fee', async () => {
    const { status, body } = await call('/v1/plans', {
      token: 'alice-token',
      method: 'POST',
      body: { recipient: { kind: 'address', address: SAM }, amount: { kind: 'token', value: '100' } },
    });

    expect(status).toBe(422);
    expect(body.error).toBe('insufficient_balance');
  });
});

/**
 * A move to Base Sepolia, planned by the real planner. Only the outside world
 * is faked: Circle's fee quote and the balances.
 */
async function planBridge(userId = 'did:privy:alice', wallet: Address = ALICE_WALLET): Promise<Plan> {
  const intent = IntentSchema.parse({
    type: 'bridge',
    token: { kind: 'symbol', symbol: 'USDC' },
    amount: { kind: 'token', value: '20' },
    toChainId: CHAIN.baseSepolia,
    rationale: 'Move $20 to Base Sepolia.',
  });

  const outcome = await buildPlan(intent, {
    resolveToken: async () => ({ chainId: CHAIN.arcTestnet, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: null, verified: true }),
    resolveRecipient: async () => ({ address: wallet, display: 'your own wallet', ensName: null, contactLabel: null, known: false, isContract: false }),
    priceOf: async () => '1',
    balanceOf: async () => 100_000_000n,
    usdcBalanceUsd: async () => '100',
    nativeBalanceUsd: async () => null,
    estimateNetworkFeeUsd: async () => '0.01',
    isAddressFlagged: async () => false,
    bridgeFees: async () => ({ forwardFee: 54_565n, protocolFeeCentiBps: 0n }),
    acrossQuote: async () => null,
    acrossSwapQuote: async () => null,
    gasZipQuote: async () => null,
    acrossNativeSwapQuote: async () => null,
  });
  if (!outcome.ok) throw new Error(outcome.failure.message);

  await store.upsertUser({ id: userId, walletAddress: wallet });
  await store.putPlan(userId, outcome.plan, 'agent');
  return outcome.plan;
}

/** The burn CCTP emits, word by word. The decoder is checked against viem's encoder in wallet-core. */
function burnReceipt(args: { depositor: string; mintRecipient: string; amount: bigint; domain: number; maxFee: bigint }): Receipt {
  const messenger = cctpContracts(CHAIN.arcTestnet)!.tokenMessenger;
  const word = (value: bigint) => value.toString(16).padStart(64, '0');
  const addr = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');
  const hook = CCTP_FORWARD_HOOK_DATA.slice(2);

  return {
    status: 'success',
    logs: [
      {
        address: messenger,
        topics: [DEPOSIT_FOR_BURN_TOPIC, `0x${addr(USDC)}`, `0x${addr(args.depositor)}`, `0x${word(1000n)}`],
        data: `0x${[
          word(args.amount),
          addr(args.mintRecipient),
          word(BigInt(args.domain)),
          addr(messenger),
          word(0n),
          word(args.maxFee),
          word(7n * 32n),
          word(BigInt(hook.length / 2)),
          hook,
        ].join('')}`,
      },
    ],
  };
}

describe('recording a move between chains', () => {
  // $20 leaves; up to $0.054565 of it is Circle's fee.
  const burn = { depositor: ALICE_WALLET, mintRecipient: ALICE_WALLET, amount: 20_000_000n, domain: 6, maxFee: 54_565n };

  it('records the exact burn the plan describes', async () => {
    const plan = await planBridge();
    chain.receipts.set(hash('b'), burnReceipt(burn));

    const { status, body } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'alice-token',
      method: 'POST',
      body: { txHash: hash('b') },
    });

    expect(status).toBe(201);
    expect(body.execution.status).toBe('success');

    // Counted against the agent's limits: the amount and every fee.
    expect(await store.spentTodayUsd('did:privy:alice')).toBe(planOutflowUsd(plan));
  });

  it.each([
    ['mints to someone else', { mintRecipient: SAM }],
    ['goes to a different chain', { domain: 3 }],
    ['burns a different amount', { amount: 1n }],
    ['allows Circle a higher fee than the user saw', { maxFee: 54_566n }],
    ['was made from someone else’s wallet', { depositor: MALLORY_WALLET }],
  ])('refuses a burn that %s, and records nothing', async (_, override) => {
    const plan = await planBridge();
    chain.receipts.set(hash('c'), burnReceipt({ ...burn, ...override }));

    const { status } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'alice-token',
      method: 'POST',
      body: { txHash: hash('c') },
    });

    expect(status).toBe(422);
    expect(await store.listExecutions('did:privy:alice')).toEqual([]);
  });

  it('does not add anyone to the one-tap list — there is no one else involved', async () => {
    const plan = await planBridge();
    chain.receipts.set(hash('d'), burnReceipt(burn));
    await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('d') } });

    expect((await store.getPolicy('did:privy:alice')).recipientAllowlist).toEqual([]);
  });
});

describe('recording an execution', () => {
  it('records a transaction that makes exactly the planned transfer', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('a'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));

    const { status, body } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'alice-token',
      method: 'POST',
      body: { txHash: hash('a') },
    });

    expect(status).toBe(201);
    expect(body.execution.status).toBe('success');
  });

  /** "People you have already sent to" — the one-tap path in Limits depends on this. */
  it('remembers the recipient once the send is verified on-chain', async () => {
    expect(await store.isKnownRecipient('did:privy:alice', SAM)).toBe(false);

    const plan = await planSend('10');
    chain.receipts.set(hash('a'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));
    await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('a') } });

    expect(await store.isKnownRecipient('did:privy:alice', SAM)).toBe(true);
  });

  it('keeps the allowlist server-side: saving limits can neither wipe nor extend it', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('a'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));
    await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('a') } });

    const { body: policy } = await call('/v1/policy', { token: 'alice-token' });
    const { status } = await call('/v1/policy', {
      token: 'alice-token',
      method: 'PUT',
      body: { ...policy, recipientAllowlist: [MALLORY_WALLET] },
    });

    expect(status).toBe(200);
    expect(await store.isKnownRecipient('did:privy:alice', SAM)).toBe(true);
    expect(await store.isKnownRecipient('did:privy:alice', MALLORY_WALLET)).toBe(false);
  });

  /** Any hash attached to any plan would otherwise pass. */
  it('refuses a transaction that moved a different amount, and records nothing', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('b'), transferReceipt(ALICE_WALLET, SAM, 1n));

    const { status } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'alice-token',
      method: 'POST',
      body: { txHash: hash('b') },
    });

    expect(status).toBe(422);
    expect(await store.listExecutions('did:privy:alice')).toEqual([]);
    expect(await store.isKnownRecipient('did:privy:alice', SAM)).toBe(false);
  });

  it('refuses a transfer sent from someone else’s wallet', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('c'), transferReceipt(MALLORY_WALLET, SAM, 10_000_000n));

    const { status } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'alice-token',
      method: 'POST',
      body: { txHash: hash('c') },
    });

    expect(status).toBe(422);
  });

  it('asks the app to retry when the transaction is not visible yet', async () => {
    const plan = await planSend('10');

    const { status, body } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'alice-token',
      method: 'POST',
      body: { txHash: hash('d') },
    });

    expect(status).toBe(202);
    expect(body.status).toBe('unconfirmed');
  });

  it('executes a plan at most once', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('e'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));

    const first = await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('e') } });
    const second = await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('e') } });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  it('will not let one user execute another user’s plan', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('f'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));

    await call('/v1/me', { token: 'mallory-token' });
    const { status } = await call(`/v1/plans/${plan.id}/executions`, {
      token: 'mallory-token',
      method: 'POST',
      body: { txHash: hash('f') },
    });

    expect(status).toBe(404);
  });

  /** The gap this milestone closes: agent spend is now actually counted. */
  it('counts an agent-originated execution toward the daily cap, fee included', async () => {
    const manual = await planSend('10');
    const agentPlan = { ...manual, id: crypto.randomUUID() };
    await store.putPlan('did:privy:alice', agentPlan, 'agent');
    chain.receipts.set(hash('9'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));

    await call(`/v1/plans/${agentPlan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('9') } });

    // $10 plus the planned fee — never just the $10.
    expect(await store.spentTodayUsd('did:privy:alice')).toBe(planOutflowUsd(agentPlan));
    expect(planOutflowUsd(agentPlan)).not.toBe('10');
  });

  it('does not count a manual send toward the agent cap', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('8'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));

    await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('8') } });

    expect(await store.spentTodayUsd('did:privy:alice')).toBe('0');
  });
});

describe('agent chat', () => {
  function captureAgent() {
    const calls: Array<{ message: string; history: readonly { role: string; content: string }[] }> = [];
    agent = async (_user, message, history) => {
      calls.push({ message, history });
      return { kind: 'reply', reply: 'ok', plan: null, decision: null, plans: [], status: 'ok', usage: {} as never, appearance: null, followUp: null };
    };
    return calls;
  }

  it('passes recent history to the agent, so it remembers the conversation', async () => {
    const calls = captureAgent();

    await call('/v1/agent/chat', {
      token: 'alice-token',
      method: 'POST',
      body: {
        message: '0x5a30000000000000000000000000000000000003',
        history: [
          { role: 'user', content: 'send $5 to Sam' },
          { role: 'assistant', content: "Who's Sam? Give me an address." },
        ],
      },
    });

    expect(calls[0]?.history).toHaveLength(2);
  });

  it('drops turns before the first user message rather than rejecting them', async () => {
    const calls = captureAgent();

    await call('/v1/agent/chat', {
      token: 'alice-token',
      method: 'POST',
      body: {
        message: 'hi',
        history: [
          { role: 'assistant', content: 'trimmed reply' },
          { role: 'user', content: 'earlier question' },
        ],
      },
    });

    expect(calls[0]?.history).toEqual([{ role: 'user', content: 'earlier question' }]);
  });

  it('caps history length, because it is billed input', async () => {
    captureAgent();
    const history = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `m${i}` }));

    const { status } = await call('/v1/agent/chat', {
      token: 'alice-token',
      method: 'POST',
      body: { message: 'hi', history },
    });

    expect(status).toBe(400);
  });
});

describe('re-quoting an expired plan', () => {
  it('returns a fresh plan with the same amount and recipient', async () => {
    const original = await planSend('10');

    const { status, body } = await call(`/v1/plans/${original.id}/requote`, { token: 'alice-token', method: 'POST' });

    expect(status).toBe(201);
    expect(body.plan.id).not.toBe(original.id);
    expect(body.plan.outflow[0].amount).toBe(original.outflow[0]?.amount);
    expect(body.plan.recipient.address).toBe(original.recipient?.address);
  });

  /** Otherwise reading the chat slowly would move agent spend out of the cap. */
  it('keeps an agent plan counted as an agent plan', async () => {
    const manual = await planSend('10');
    const agentPlan = { ...manual, id: crypto.randomUUID() };
    await store.putPlan('did:privy:alice', agentPlan, 'agent');

    const { body } = await call(`/v1/plans/${agentPlan.id}/requote`, { token: 'alice-token', method: 'POST' });

    expect((await store.getPlan('did:privy:alice', body.plan.id))?.origin).toBe('agent');
  });

  it('refuses an agent plan once the daily cap has filled in the meantime', async () => {
    const manual = await planSend('10');
    const agentPlan = { ...manual, id: crypto.randomUUID() };
    await store.putPlan('did:privy:alice', agentPlan, 'agent');
    await store.setPolicy('did:privy:alice', {
      enabled: true,
      perTxCapUsd: '100',
      dailyCapUsd: '5',
      autoExecuteThresholdUsd: '1',
      allowedActions: ['transfer'],
      tokenAllowlist: ['USDC'],
      recipientAllowlist: [],
    });

    const { status, body } = await call(`/v1/plans/${agentPlan.id}/requote`, { token: 'alice-token', method: 'POST' });

    expect(status).toBe(422);
    expect(body.error).toBe('denied');
  });

  it('will not re-quote another user’s plan', async () => {
    const plan = await planSend('10');
    await call('/v1/me', { token: 'mallory-token' });

    const { status } = await call(`/v1/plans/${plan.id}/requote`, { token: 'mallory-token', method: 'POST' });

    expect(status).toBe(404);
  });
});

describe('activity', () => {
  it('shows a recorded send even before the explorer indexes it', async () => {
    const plan = await planSend('10');
    chain.receipts.set(hash('7'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));
    await call(`/v1/plans/${plan.id}/executions`, { token: 'alice-token', method: 'POST', body: { txHash: hash('7') } });

    const { body } = await call('/v1/activity', { token: 'alice-token' });

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ direction: 'sent', counterparty: SAM, amount: '10' });
  });

  it('marks the feed incomplete when the explorer is down, rather than empty', async () => {
    explorer = async () => {
      throw new Error('down');
    };

    const { status, body } = await call('/v1/activity', { token: 'alice-token' });

    expect(status).toBe(200);
    expect(body.complete).toBe(false);
  });
});

describe('choosing what to send', () => {
  it('rejects an asset on a chain Blocky does not know, before planning anything', async () => {
    const response = await call('/v1/plans', {
      token: 'alice-token',
      method: 'POST',
      body: {
        recipient: { kind: 'address', address: '0x1111111111111111111111111111111111111111' },
        amount: { kind: 'usd', value: '5' },
        asset: { symbol: 'ETH', chainId: 999999 },
      },
    });

    expect(response.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/*  Money between people                                                       */
/* -------------------------------------------------------------------------- */

async function claim(token: string, username: string) {
  return call('/v1/me/username', { token, method: 'PUT', body: { username } });
}

async function report(token: string, planId: string, txHash: string) {
  return call(`/v1/plans/${planId}/executions`, { token, method: 'POST', body: { txHash } });
}

describe('usernames', () => {
  it('claims a name, case-insensitively, once', async () => {
    expect((await claim('alice-token', '@Alice')).body.username).toBe('alice');
    expect((await claim('mallory-token', 'ALICE')).status).toBe(409);
    expect((await claim('mallory-token', 'a!')).status).toBe(400);
    expect((await claim('mallory-token', 'blocky')).status).toBe(400);
    expect((await call('/v1/me', { token: 'alice-token' })).body.username).toBe('alice');
  });

  it('says who a name is, to pay them', async () => {
    await claim('alice-token', 'alice');
    const { status, body } = await call('/v1/users/alice', { token: 'mallory-token' });

    expect(status).toBe(200);
    expect(body.walletAddress).toBe(ALICE_WALLET);
    expect((await call('/v1/users/nobody', { token: 'mallory-token' })).status).toBe(404);
  });

  it('pays someone by their name', async () => {
    await claim('mallory-token', 'mallory');
    const { status, body } = await call('/v1/plans', {
      token: 'alice-token',
      method: 'POST',
      body: { recipient: { kind: 'username', username: '@mallory' }, amount: { kind: 'usd', value: '5' } },
    });

    expect(status).toBe(201);
    expect(body.plan.recipient).toMatchObject({ address: MALLORY_WALLET, display: '@mallory' });
  });
});

describe('payment requests', () => {
  beforeEach(async () => {
    await claim('alice-token', 'alice');
    await claim('mallory-token', 'mallory');
    // They know each other: Mallory saved Alice as a contact.
    await store.saveContact('did:privy:mallory', 'Alice', ALICE_WALLET as Address);
  });

  it('asks, tells the one asked, and settles itself when the payment lands', async () => {
    const created = await call('/v1/requests', {
      token: 'alice-token',
      method: 'POST',
      body: { payer: '@mallory', amountUsd: '12', note: 'lunch' },
    });
    expect(created.status).toBe(201);
    expect(created.body.shareText).toContain('@alice is asking for $12.00 for lunch');

    const inbox = (await call('/v1/notifications', { token: 'mallory-token' })).body;
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: 'request_received', title: '@alice requested $12.00' });

    const paying = await call(`/v1/requests/${created.body.request.id}/pay`, { token: 'mallory-token', method: 'POST' });
    expect(paying.status).toBe(201);
    expect(paying.body.plan.recipient.address).toBe(ALICE_WALLET);

    chain.receipts.set(hash('d'), transferReceipt(MALLORY_WALLET, ALICE_WALLET, 12_000_000n));
    expect((await report('mallory-token', paying.body.plan.id, hash('d'))).status).toBe(201);

    const after = (await call(`/v1/requests/${created.body.request.id}`, { token: 'alice-token' })).body.request;
    expect(after).toMatchObject({ status: 'paid', txHash: hash('d') });
    const aliceInbox = (await call('/v1/notifications', { token: 'alice-token' })).body.items;
    expect(aliceInbox[0]).toMatchObject({ kind: 'request_paid', title: '@mallory paid your request' });
  });

  it('settles a request paid by an ordinary send of the same amount', async () => {
    const created = await call('/v1/requests', { token: 'alice-token', method: 'POST', body: { payer: 'mallory', amountUsd: '7' } });
    const { body } = await call('/v1/plans', {
      token: 'mallory-token',
      method: 'POST',
      body: { recipient: { kind: 'username', username: 'alice' }, amount: { kind: 'usd', value: '7' } },
    });
    chain.receipts.set(hash('e'), transferReceipt(MALLORY_WALLET, ALICE_WALLET, 7_000_000n));
    await report('mallory-token', body.plan.id, hash('e'));

    expect((await call(`/v1/requests/${created.body.request.id}`, { token: 'alice-token' })).body.request.status).toBe('paid');
  });

  it('lets only the one asked pay it, and lets them decline', async () => {
    const created = await call('/v1/requests', { token: 'alice-token', method: 'POST', body: { payer: 'mallory', amountUsd: '3' } });
    const id = created.body.request.id;

    // Not hers to pay: it asks Mallory.
    expect((await call(`/v1/requests/${id}/pay`, { token: 'alice-token', method: 'POST' })).status).toBe(403);
    expect((await call(`/v1/requests/${id}/decline`, { token: 'mallory-token', method: 'POST' })).body.status).toBe('declined');
    expect((await call(`/v1/requests/${id}/pay`, { token: 'mallory-token', method: 'POST' })).status).toBe(409);
  });

  it('refuses to ask someone who is not on Blocky', async () => {
    const { status } = await call('/v1/requests', { token: 'alice-token', method: 'POST', body: { payer: 'ghost', amountUsd: '3' } });
    expect(status).toBe(404);
  });

  it('tells a Blocky user when someone sends them money', async () => {
    const { body } = await call('/v1/plans', {
      token: 'alice-token',
      method: 'POST',
      body: { recipient: { kind: 'address', address: MALLORY_WALLET }, amount: { kind: 'usd', value: '4' } },
    });
    chain.receipts.set(hash('f'), transferReceipt(ALICE_WALLET, MALLORY_WALLET, 4_000_000n));
    await report('alice-token', body.plan.id, hash('f'));

    const inbox = (await call('/v1/notifications', { token: 'mallory-token' })).body;
    expect(inbox.items[0]).toMatchObject({ kind: 'money_received', title: '@alice sent you $4.00' });

    await call('/v1/notifications/read', { token: 'mallory-token', method: 'POST' });
    expect((await call('/v1/notifications', { token: 'mallory-token' })).body.unread).toBe(0);
  });
});

describe('savings pots', () => {
  it('sets money aside, and warns a send that would spend it', async () => {
    const pot = (await call('/v1/pots', { token: 'alice-token', method: 'POST', body: { name: 'Trip', targetUsd: '500' } })).body.pot;
    // $100 in the wallet; $60 of it for the trip.
    const adjusted = await call(`/v1/pots/${pot.id}/adjust`, { token: 'alice-token', method: 'POST', body: { deltaUsd: '60' } });
    expect(adjusted.body.pot.savedUsd).toBe('60');

    const plan = await planSend('50');
    expect(plan.warnings.find((w) => w.code === 'dips_into_pot')?.message).toMatch(/money you set aside \(Trip\)/);
    expect((await planSend('10')).warnings.map((w) => w.code)).not.toContain('dips_into_pot');
  });

  it('never sets aside more than the wallet holds', async () => {
    const pot = (await call('/v1/pots', { token: 'alice-token', method: 'POST', body: { name: 'Car' } })).body.pot;
    expect((await call(`/v1/pots/${pot.id}/adjust`, { token: 'alice-token', method: 'POST', body: { deltaUsd: '150' } })).status).toBe(422);
    const out = await call(`/v1/pots/${pot.id}/adjust`, { token: 'alice-token', method: 'POST', body: { deltaUsd: '-5' } });
    expect(out.body.pot.savedUsd).toBe('0');
  });
});

describe('insights and budgets', () => {
  it('counts what was sent to people this month, and warns at 80% of a budget', async () => {
    await call('/v1/budgets', { token: 'alice-token', method: 'PUT', body: { category: 'people', monthlyUsd: '12' } });

    const plan = await planSend('10');
    chain.receipts.set(hash('a'), transferReceipt(ALICE_WALLET, SAM, 10_000_000n));
    await report('alice-token', plan.id, hash('a'));

    const { body } = await call('/v1/insights', { token: 'alice-token' });
    expect(body.insights).toMatchObject({ spentUsd: '10', byCategory: { people: '10', investing: '0' }, count: 1 });
    expect(body.budgets).toEqual([{ category: 'people', monthlyUsd: '12', spentUsd: '10' }]);

    const inbox = (await call('/v1/notifications', { token: 'alice-token' })).body.items;
    expect(inbox.find((n: { kind: string }) => n.kind === 'budget')?.title).toBe('80% of your sending budget');
  });

  it('exports a month as CSV', async () => {
    const response = await app().request(`/v1/statements/${new Date().toISOString().slice(0, 7)}.csv`, {
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect((await response.text()).split('\n')[0]).toBe('date,category,description,sent,sent_usd,received,fees_usd');
  });
});

describe('price alerts', () => {
  it('fires once when the price crosses the line, and not before', async () => {
    await call('/v1/me', { token: 'alice-token' });
    await store.addPriceAlert('did:privy:alice', { symbol: 'eth', direction: 'below', thresholdUsd: '2500' });

    expect(await checkPriceAlerts(store, async () => '2600')).toBe(0);
    expect(await checkPriceAlerts(store, async () => '2450.5')).toBe(1);
    expect(await checkPriceAlerts(store, async () => '2400')).toBe(0);

    const inbox = (await call('/v1/notifications', { token: 'alice-token' })).body.items;
    expect(inbox[0]).toMatchObject({ kind: 'price_alert', title: 'ETH is below $2,500.00' });
  });
});

describe('requests from strangers', () => {
  beforeEach(async () => {
    await claim('alice-token', 'alice');
    await claim('mallory-token', 'mallory');
  });

  const ask = (amountUsd = '5') =>
    call('/v1/requests', { token: 'alice-token', method: 'POST', body: { payer: 'mallory', amountUsd } });

  it('reach the one asked quietly: no notification, marked as from a stranger', async () => {
    expect((await ask()).status).toBe(201);

    expect((await call('/v1/notifications', { token: 'mallory-token' })).body.unread).toBe(0);
    const { incoming } = (await call('/v1/requests', { token: 'mallory-token' })).body;
    expect(incoming[0]).toMatchObject({ status: 'open', fromStranger: true });
  });

  it('are no longer strange once they have paid you', async () => {
    const { body } = await call('/v1/plans', {
      token: 'alice-token',
      method: 'POST',
      body: { recipient: { kind: 'username', username: 'mallory' }, amount: { kind: 'usd', value: '2' } },
    });
    chain.receipts.set(hash('b'), transferReceipt(ALICE_WALLET, MALLORY_WALLET, 2_000_000n));
    await report('alice-token', body.plan.id, hash('b'));
    await call('/v1/notifications/read', { token: 'mallory-token', method: 'POST' });

    await ask();
    expect((await call('/v1/notifications', { token: 'mallory-token' })).body.unread).toBe(1);
  });

  it('stop, silently, once blocked', async () => {
    const first = (await ask()).body.request;
    expect((await call(`/v1/requests/${first.id}/block`, { token: 'mallory-token', method: 'POST' })).body.blocked).toBe(true);

    // Alice isn't told she's blocked — the request just goes nowhere.
    expect((await ask('6')).status).toBe(201);
    const { incoming } = (await call('/v1/requests', { token: 'mallory-token' })).body;
    expect(incoming.every((r: { status: string }) => r.status !== 'open')).toBe(true);
  });

  it('are limited: three open to the same person at once', async () => {
    for (let i = 0; i < 3; i++) expect((await ask()).status).toBe(201);
    const fourth = await ask();
    expect(fourth.status).toBe(429);
    expect(fourth.body.message).toMatch(/3 open requests to @mallory/);
  });
});

describe('waitlist', () => {
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE waitlist`);
  });

  it('takes a signup without a token, and counts places in order', async () => {
    const first = await call('/waitlist', { method: 'POST', body: { email: 'ada@example.com', source: 'hero' } });
    expect(first).toEqual({ status: 200, body: { ok: true, position: 1, alreadyJoined: false } });

    const second = await call('/waitlist', { method: 'POST', body: { email: 'sam@example.com' } });
    expect(second.body.position).toBe(2);
  });

  it('treats the same address twice as one signup, keeping its place', async () => {
    await call('/waitlist', { method: 'POST', body: { email: 'ada@example.com' } });
    await call('/waitlist', { method: 'POST', body: { email: 'sam@example.com' } });

    const again = await call('/waitlist', { method: 'POST', body: { email: '  ADA@example.com ' } });
    expect(again.body).toEqual({ ok: true, position: 1, alreadyJoined: true });
  });

  it('rejects something that is not an email', async () => {
    const { status, body } = await call('/waitlist', { method: 'POST', body: { email: 'not an email' } });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_email');
  });

  it('pretends to accept a bot that filled the hidden field, and stores nothing', async () => {
    const { status } = await call('/waitlist', { method: 'POST', body: { email: 'bot@example.com', website: 'spam' } });
    expect(status).toBe(200);

    const rows = await database.db.execute(sql`select count(*)::int as n from waitlist`);
    expect((rows as any).rows?.[0]?.n ?? (rows as any)[0]?.n).toBe(0);
  });
});

describe('waitlist abuse limits', () => {
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE waitlist`);
  });

  it('turns away the thirty-first try from one address within the hour', async () => {
    const shared = app();
    const from = (email: string) =>
      shared.request('/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({ email }),
      });

    for (let i = 0; i < 30; i += 1) expect((await from(`p${i}@example.com`)).status).toBe(200);
    expect((await from('p30@example.com')).status).toBe(429);
  });

  it('refuses a body far bigger than any signup', async () => {
    const { status } = await call('/waitlist', { method: 'POST', body: { email: 'a@example.com', source: 'x'.repeat(5000) } });
    expect(status).toBe(413);
  });
});
