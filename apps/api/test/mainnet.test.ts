import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Swaps and gas top-ups exist on mainnet only. The network is chosen as the
// shared packages load, so switch before anything imports them.
vi.hoisted(() => {
  process.env.BLOCKY_NETWORK = 'mainnet';
});

import { buildPlan, type PlannerContext } from '@blocky/planner';
import { CHAIN, IntentSchema, type Address, type Plan } from '@blocky/shared';
import {
  NATIVE_TOKEN,
  acrossPeriphery,
  acrossSpokePool,
  stockBySymbol,
  gasZipDepositContract,
  groupCalls,
  transactionFor,
  type ChainReader,
  type Receipt,
} from '@blocky/wallet-core';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { IdentityProvider } from '../src/auth';
import { openDatabase, type Database } from '../src/db/client';
import { createStore, type Store } from '../src/store';

/**
 * Verifying what the phone reports for plans that go out as more than one
 * transaction, or whose calldata is partly a third party's. The rule is the
 * same as everywhere: every transaction reported must be exactly its part of
 * the plan, sent from the user's wallet — or nothing is recorded.
 */

const WALLET = '0xa11ce00000000000000000000000000000000001' as Address;
const OTHER = '0x3a11040000000000000000000000000000000002' as Address;
const USDC = '0x3600000000000000000000000000000000000000' as Address;
const SPOKE = acrossSpokePool(CHAIN.arc)!;
const GAS_ZIP = gasZipDepositContract(CHAIN.arc)!;

let database: Database;
let store: Store;
const receipts = new Map<string, Receipt>();

const identity: IdentityProvider = {
  async verifyAccessToken(token) {
    return token === 'alice-token' ? 'did:privy:alice' : null;
  },
  async embeddedWalletAddress() {
    return WALLET;
  },
};

const reader = {
  supports: () => true,
  transactionReceipt: async (_chainId: number, hash: string) => receipts.get(hash) ?? null,
} as unknown as ChainReader;

function app() {
  return createApp({
    store,
    reader,
    identity,
    agent: null,
    gatewayBalances: async () => ({ totalUsd: '0', perChain: [] }),
    walletHoldings: async () => [],
    explorerTransfers: async () => [],
    receiptPolling: { attempts: 1, delayMs: 0 },
  });
}

async function report(planId: string, txHashes: string[]) {
  const response = await app().request(`/v1/plans/${planId}/executions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer alice-token' },
    body: JSON.stringify({ txHashes }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const hash = (char: string) => `0x${char.repeat(64)}`;

/** The receipt of a transaction that is exactly `calls`, sent by `from`. */
function sent(calls: Plan['calls'], from: Address = WALLET, status: Receipt['status'] = 'success'): Receipt {
  const tx = transactionFor(calls);
  return { status, logs: [], transaction: { from, to: tx.to, value: tx.value, input: tx.data } };
}

function context(over: Partial<PlannerContext> = {}): PlannerContext {
  return {
    resolveToken: async () => ({ chainId: CHAIN.arc, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: null, verified: true }),
    resolveRecipient: async () => ({ address: WALLET, display: 'your own wallet', ensName: null, contactLabel: null, known: false, isContract: false }),
    priceOf: async (token) => (token.address === NATIVE_TOKEN ? '2600' : '1'),
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
    ...over,
  };
}

async function stored(intent: Record<string, unknown>, ctx: PlannerContext): Promise<Plan> {
  const outcome = await buildPlan(
    IntentSchema.parse({ type: 'bridge', token: { kind: 'symbol', symbol: 'USDC' }, amount: { kind: 'token', value: '20' }, rationale: 'Move it as the user asked.', ...intent }),
    ctx,
  );
  if (!outcome.ok) throw new Error(outcome.failure.message);
  await store.upsertUser({ id: 'did:privy:alice', walletAddress: WALLET });
  await store.putPlan('did:privy:alice', outcome.plan, 'agent');
  return outcome.plan;
}

const gasZipQuote = (inputAmount: bigint) => ({
  contract: GAS_ZIP,
  shortId: 57,
  inputAmount,
  value: inputAmount * 10n ** 12n,
  expectedOut: 7_690_000_000_000_000n,
  outDecimals: 18,
  etaSeconds: 1,
});

beforeAll(async () => {
  database = await openDatabase({});
  store = createStore(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`TRUNCATE executions, plans, sessions, contacts, policies, users CASCADE`);
  receipts.clear();
});

describe('a swap into ETH through Gas.zip', () => {
  const plan = () =>
    stored(
      { toChainId: CHAIN.arbitrum, receive: { kind: 'symbol', symbol: 'ETH' } },
      context({ gasZipQuote: async (_f, _t, input) => gasZipQuote(input) }),
    );

  it('records the exact deposit the plan describes', async () => {
    const p = await plan();
    receipts.set(hash('a'), sent(p.calls));

    const { status } = await report(p.id, [hash('a')]);

    expect(status).toBe(201);
  });

  it.each([
    ['sent from someone else', (p: Plan) => sent(p.calls, OTHER)],
    ['that reverted', (p: Plan) => sent(p.calls, WALLET, 'reverted')],
    ['carrying a different amount', (p: Plan) => sent([{ ...p.calls[0]!, value: '1' }])],
    ['the node returned without its transaction', () => ({ status: 'success' as const, logs: [] })],
  ])('refuses one %s, and records nothing', async (_, make) => {
    const p = await plan();
    receipts.set(hash('b'), make(p));

    expect((await report(p.id, [hash('b')])).status).toBe(422);
    expect(await store.listExecutions('did:privy:alice')).toEqual([]);
  });
});

describe('an Across swap', () => {
  const plan = () =>
    stored(
      { toChainId: CHAIN.hyperevm, receive: { kind: 'symbol', symbol: 'HYPE' } },
      context({
        acrossSwapQuote: async (_f, _t, input) => ({
          spokePool: SPOKE,
          inputAmount: input,
          depositData: '0xad5425c6deadbeef',
          outputToken: NATIVE_TOKEN,
          expectedOut: 218_000_000_000_000_000n,
          minOut: 207_000_000_000_000_000n,
          etaSeconds: 2,
        }),
      }),
    );

  it('records the exact transaction — approve and Across’s deposit, batched', async () => {
    const p = await plan();
    receipts.set(hash('c'), sent(p.calls));

    expect((await report(p.id, [hash('c')])).status).toBe(201);
  });

  it('refuses a transaction whose deposit differs from the one approved', async () => {
    const p = await plan();
    receipts.set(hash('d'), sent([p.calls[0]!, { ...p.calls[1]!, data: '0xad5425c6feedface' }]));

    expect((await report(p.id, [hash('d')])).status).toBe(422);
  });
});

describe('a move with a gas top-up: two transactions', () => {
  const plan = () =>
    stored(
      { toChainId: CHAIN.base, includeGas: true },
      context({ gasZipQuote: async (_f, _t, input) => gasZipQuote(input) }),
    );

  it('goes out as the move, then the top-up on its own', async () => {
    const p = await plan();

    expect(groupCalls(p.calls).map((group) => group.length)).toEqual([2, 1]);
  });

  it('records both when both are exactly their part of the plan', async () => {
    const p = await plan();
    const [move, topUp] = groupCalls(p.calls);
    // The move is a CCTP burn, verified on its event; build that receipt from the plan.
    receipts.set(hash('e'), burnReceipt(p));
    receipts.set(hash('f'), sent(topUp!));

    const { status } = await report(p.id, [hash('e'), hash('f')]);

    expect(move).toHaveLength(2);
    expect(status).toBe(201);
    expect((await store.listExecutions('did:privy:alice'))[0]?.summary).not.toMatch(/not sent/);
  });

  it('records the move alone, and says so, when the top-up never went out', async () => {
    const p = await plan();
    receipts.set(hash('e'), burnReceipt(p));

    expect((await report(p.id, [hash('e')])).status).toBe(201);
    expect((await store.listExecutions('did:privy:alice'))[0]?.summary).toMatch(/gas top-up was not sent/);
  });

  it('refuses a top-up that is not the planned one', async () => {
    const p = await plan();
    const [, topUp] = groupCalls(p.calls);
    receipts.set(hash('e'), burnReceipt(p));
    receipts.set(hash('f'), sent([{ ...topUp![0]!, value: '1' }]));

    expect((await report(p.id, [hash('e'), hash('f')])).status).toBe(422);
    expect(await store.listExecutions('did:privy:alice')).toEqual([]);
  });

  it('refuses more transactions than the plan makes', async () => {
    const p = await plan();

    expect((await report(p.id, [hash('e'), hash('f'), hash('0')])).status).toBe(422);
  });
});

/** A CCTP burn of the plan's move, word by word, as the messenger emits it. */
function burnReceipt(plan: Plan): Receipt {
  const messenger = plan.calls[1]!.to;
  // What was burned: what left, less Blocky's fee when there is one.
  const input = BigInt(plan.outflow[0]!.amount) - BigInt(plan.blockyFee?.amount ?? 0);
  const maxFee = input - BigInt(plan.inflow[0]!.amount);
  const word = (value: bigint) => value.toString(16).padStart(64, '0');
  const addr = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');
  const hook = '636374702d666f72776172640000000000000000000000000000000000000000';

  return {
    status: 'success',
    logs: [
      {
        address: messenger,
        topics: [
          '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5',
          `0x${addr(USDC)}`,
          `0x${addr(WALLET)}`,
          `0x${word(1000n)}`,
        ],
        data: `0x${[word(input), addr(WALLET), word(6n), addr(messenger), word(0n), word(maxFee), word(7n * 32n), word(32n), hook].join('')}`,
      },
    ],
  };
}

describe('coming home from another chain', () => {
  const ETH_ON_ARBITRUM = { chainId: CHAIN.arbitrum, address: NATIVE_TOKEN, symbol: 'ETH', name: 'ETH', decimals: 18, logoUrl: null, verified: true } as const;
  const ARB_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Address;

  const onArbitrum = (over: Partial<PlannerContext> = {}) =>
    context({
      resolveToken: async (ref, chainId) =>
        ref.kind === 'symbol' && ref.symbol === 'ETH'
          ? ETH_ON_ARBITRUM
          : { chainId, address: chainId === CHAIN.arbitrum ? ARB_USDC : USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: null, verified: true },
      balanceOf: async (token) => (token.address === NATIVE_TOKEN ? 10_000_000_000_000_000n : 50_000_000n),
      nativeBalanceUsd: async () => '26',
      ...over,
    });

  it('records selling ETH on Arbitrum for Arc USDC — one exact transaction on Arbitrum', async () => {
    const p = await stored(
      { fromChainId: CHAIN.arbitrum, toChainId: CHAIN.arc, token: { kind: 'symbol', symbol: 'ETH' }, amount: { kind: 'token', value: '0.005' } },
      onArbitrum({
        acrossNativeSwapQuote: async (_f, _t, input) => ({
          periphery: '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4',
          inputToken: NATIVE_TOKEN,
          inputAmount: input,
          data: '0x110560addeadbeef',
          outputToken: USDC,
          expectedOut: 13_460_000n,
          minOut: 13_360_000n,
          etaSeconds: 1,
        }),
      }),
    );
    receipts.set(hash('a'), sent(p.calls));

    expect((await report(p.id, [hash('a')])).status).toBe(201);
    expect((await store.listExecutions('did:privy:alice'))[0]?.chainId).toBe(CHAIN.arbitrum);
  });

  it('needs both transactions of a USDC move from Arbitrum — approve alone moved nothing', async () => {
    const p = await stored(
      { fromChainId: CHAIN.arbitrum, toChainId: CHAIN.arc },
      onArbitrum({
        acrossQuote: async (_f, _t, input) => ({
          spokePool: acrossSpokePool(CHAIN.arbitrum)!,
          inputToken: ARB_USDC,
          outputToken: USDC,
          inputAmount: input,
          outputAmount: input - 5_000n,
          destinationChainId: CHAIN.arc,
          exclusiveRelayer: '0x0000000000000000000000000000000000000000',
          quoteTimestamp: 1,
          fillDeadline: 2,
          exclusivityDeadline: 0,
          etaSeconds: 0,
        }),
      }),
    );
    const [approve, deposit] = groupCalls(p.calls);
    expect(groupCalls(p.calls)).toHaveLength(2);

    receipts.set(hash('b'), sent(approve!));
    expect((await report(p.id, [hash('b')])).status).toBe(422);

    receipts.set(hash('c'), sent(deposit!));
    expect((await report(p.id, [hash('b'), hash('c')])).status).toBe(201);
  });
});

describe("Blocky's fee", () => {
  const TREASURY = '0x7777777777777777777777777777777777777777' as Address;
  const charging = (over: Partial<PlannerContext> = {}) => context({ blockyFee: () => ({ recipient: TREASURY, bps: 50 }), ...over });

  /** The USDC Transfer event of the fee, as the token emits it. */
  function feeLog(to: Address, amount: bigint): Receipt['logs'][number] {
    const addr = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
    return {
      address: USDC,
      topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', addr(WALLET), addr(to)],
      data: `0x${amount.toString(16).padStart(64, '0')}`,
    };
  }

  const move = () => stored({ toChainId: CHAIN.base }, charging());

  it('rides in the same batch as the move', async () => {
    const p = await move();

    expect(groupCalls(p.calls).map((group) => group.length)).toEqual([3]);
    expect(p.blockyFee).toMatchObject({ amount: '100000', recipient: TREASURY });
  });

  it('records a move whose fee landed exactly as planned', async () => {
    const p = await move();
    const burn = burnReceipt(p);
    receipts.set(hash('a'), { ...burn, logs: [...burn.logs, feeLog(TREASURY, 100_000n)] });

    expect((await report(p.id, [hash('a')])).status).toBe(201);
  });

  it.each([
    ['dropped', () => []],
    ['sent somewhere else', () => [feeLog(OTHER, 100_000n)]],
    ['smaller', () => [feeLog(TREASURY, 1n)]],
  ])('refuses a move whose fee was %s, and records nothing', async (_, logs) => {
    const p = await move();
    const burn = burnReceipt(p);
    receipts.set(hash('b'), { ...burn, logs: [...burn.logs, ...logs()] });

    expect((await report(p.id, [hash('b')])).status).toBe(422);
    expect(await store.listExecutions('did:privy:alice')).toEqual([]);
  });

  describe('after a move that has to go alone', () => {
    const swap = () =>
      stored(
        { toChainId: CHAIN.arbitrum, receive: { kind: 'symbol', symbol: 'ETH' } },
        charging({ gasZipQuote: async (_f, _t, input) => gasZipQuote(input) }),
      );

    it('goes out after the Gas.zip deposit, as its own transaction', async () => {
      const p = await swap();

      expect(groupCalls(p.calls).map((group) => group[0]!.to)).toEqual([GAS_ZIP, USDC]);
    });

    it('is required, and the deposit is what gets recorded', async () => {
      const p = await swap();
      const [deposit, fee] = groupCalls(p.calls);
      receipts.set(hash('c'), sent(deposit!));
      receipts.set(hash('d'), sent(fee!));

      expect((await report(p.id, [hash('c')])).status).toBe(422);
      expect((await report(p.id, [hash('c'), hash('d')])).status).toBe(201);
      expect((await store.listExecutions('did:privy:alice'))[0]?.txHash).toBe(hash('c'));
    });
  });
});

describe('stocks', () => {
  const APPLE = stockBySymbol('AAPL')!;
  const PERIPHERY = acrossPeriphery(CHAIN.robinhood)!;
  const appleToken = { chainId: CHAIN.robinhood, address: APPLE.address, symbol: 'AAPL', name: 'Apple', decimals: 18, logoUrl: null, verified: true } as const;
  const priceOf: PlannerContext['priceOf'] = async (token) => (token.address === APPLE.address ? '340' : token.address === NATIVE_TOKEN ? '2600' : '1');

  it('records a buy — approve and Across’s deposit from Arc, exactly as planned', async () => {
    const p = await stored(
      { toChainId: CHAIN.robinhood, receive: { kind: 'symbol', symbol: 'AAPL' } },
      context({
        resolveToken: async (_ref, chainId) =>
          chainId === CHAIN.robinhood ? appleToken : { chainId: CHAIN.arc, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: null, verified: true },
        priceOf,
        acrossSwapQuote: async (_f, _t, input) => ({
          spokePool: SPOKE,
          inputAmount: input,
          depositData: '0xad5425c6deadbeef',
          outputToken: APPLE.address,
          expectedOut: (input * 10n ** 12n * 998n) / 340_000n,
          minOut: (input * 10n ** 12n * 950n) / 340_000n,
          etaSeconds: 2,
        }),
      }),
    );
    receipts.set(hash('a'), sent(p.calls));

    expect(p.summary).toMatch(/^Buy \$20\.00 of Apple/);
    expect((await report(p.id, [hash('a')])).status).toBe(201);
  });

  const selling = (token = appleToken) =>
    stored(
      { fromChainId: CHAIN.robinhood, toChainId: CHAIN.arc, token: { kind: 'symbol', symbol: 'AAPL' }, amount: { kind: 'max' } },
      context({
        resolveToken: async (_ref, chainId) =>
          chainId === CHAIN.robinhood ? token : { chainId: CHAIN.arc, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: null, verified: true },
        priceOf,
        balanceOf: async () => 500_000_000_000_000_000n,
        nativeBalanceUsd: async () => '1',
        acrossNativeSwapQuote: async (_f, _t, input, _r, inputToken) => ({
          periphery: PERIPHERY,
          inputToken: inputToken!,
          inputAmount: input,
          data: '0x110560addeadbeef',
          outputToken: USDC,
          expectedOut: 169_800_000n,
          minOut: 166_000_000n,
          etaSeconds: 1,
        }),
      }),
    );

  it('records a sale — the approval, then the sale, each exactly as planned', async () => {
    const p = await selling();
    const [approve, sell] = groupCalls(p.calls);
    receipts.set(hash('b'), sent(approve!));
    receipts.set(hash('c'), sent(sell!));

    expect(approve![0]!.to).toBe(APPLE.address);
    expect((await report(p.id, [hash('b')])).status).toBe(422);
    expect((await report(p.id, [hash('b'), hash('c')])).status).toBe(201);
  });
});

describe('sending from another chain', () => {
  const ETH_ON_ARBITRUM = { chainId: CHAIN.arbitrum, address: NATIVE_TOKEN, symbol: 'ETH', name: 'ETH', decimals: 18, logoUrl: null, verified: true } as const;
  const FRIEND = '0x73ecf78d0ef70b850a76774cd3a20b59d4236d8d' as Address;

  async function storedSend(): Promise<Plan> {
    const outcome = await buildPlan(
      IntentSchema.parse({
        type: 'transfer',
        token: { kind: 'symbol', symbol: 'ETH' },
        amount: { kind: 'token', value: '0.001' },
        recipient: { kind: 'address', address: FRIEND },
        chainId: CHAIN.arbitrum,
        rationale: 'Send ETH from Arbitrum to that address.',
      }),
      context({
        resolveToken: async () => ETH_ON_ARBITRUM,
        resolveRecipient: async () => ({ address: FRIEND, display: '0x73ec…6d8d', ensName: null, contactLabel: null, known: false, isContract: false }),
        balanceOf: async () => 10_000_000_000_000_000n,
        nativeBalanceUsd: async () => '26',
      }),
    );
    if (!outcome.ok) throw new Error(outcome.failure.message);
    await store.upsertUser({ id: 'did:privy:alice', walletAddress: WALLET });
    await store.putPlan('did:privy:alice', outcome.plan, 'agent');
    return outcome.plan;
  }

  it('records ETH sent on Arbitrum — the exact transaction, since ETH leaves no Transfer log', async () => {
    const p = await storedSend();
    receipts.set(hash('a'), sent(p.calls));

    expect(p.calls[0]).toMatchObject({ chainId: CHAIN.arbitrum, to: FRIEND, value: '1000000000000000', data: '0x' });
    expect((await report(p.id, [hash('a')])).status).toBe(201);
  });

  it('refuses one that sent a different amount', async () => {
    const p = await storedSend();
    receipts.set(hash('b'), sent([{ ...p.calls[0]!, value: '2000000000000000' }]));

    expect((await report(p.id, [hash('b')])).status).toBe(422);
  });
});
