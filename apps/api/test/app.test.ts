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
      return { kind: 'reply', reply: 'ok', plan: null, decision: null, plans: [], status: 'ok', usage: {} as never };
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
