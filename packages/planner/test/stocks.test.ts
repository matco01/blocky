import { vi, describe, expect, it } from 'vitest';

// Stocks live on mainnet only. The network is chosen as the shared packages
// load, so switch before anything imports them.
vi.hoisted(() => {
  process.env.BLOCKY_NETWORK = 'mainnet';
});

import { CHAIN, IntentSchema, PlanSchema, type Plan, type ResolvedToken } from '@blocky/shared';
import {
  NATIVE_TOKEN,
  acrossPeriphery,
  acrossSpokePool,
  stockBySymbol,
  type AcrossNativeSwapQuote,
  type AcrossSwapQuote,
  type GasZipQuote,
} from '@blocky/wallet-core';
import { encodeErc20Approve } from '../src/calls';
import type { PlannerContext } from '../src/context';
import { buildPlan } from '../src/plan';
import { bridgeIntent, fakeContext, tokenOn } from './factories';

/**
 * Buying and selling stocks: tokenized US shares on Robinhood Chain, bought
 * with Arc USDC in one step and sold back the same way. What's pinned here:
 * only listed stocks, the gas to sell later comes along on its own, and a
 * trade too big for the market is refused with the number rather than made.
 */

const USDC_ARC = tokenOn(CHAIN.arc);
const APPLE = stockBySymbol('AAPL')!;
const APPLE_TOKEN: ResolvedToken = {
  chainId: CHAIN.robinhood,
  address: APPLE.address,
  symbol: 'AAPL',
  name: 'Apple • Robinhood Token',
  decimals: 18,
  logoUrl: null,
  verified: true,
};
const PERIPHERY = acrossPeriphery(CHAIN.robinhood)!;

/** Apple at $340; USDC at $1. */
const priceOf: PlannerContext['priceOf'] = async (token) => (token.address === APPLE.address ? '340' : token.address === NATIVE_TOKEN ? '2600' : '1');

/** Across delivering Apple at the market price, less `lossBps`. USDC in, 6 decimals; Apple out, 18. */
function buyQuote(inputAmount: bigint, lossBps = 20n): AcrossSwapQuote {
  const atMarket = (inputAmount * 10n ** 12n) / 340n;
  const expectedOut = (atMarket * (10_000n - lossBps)) / 10_000n;
  return {
    spokePool: acrossSpokePool(CHAIN.arc)!,
    inputAmount,
    depositData: '0xad5425c6deadbeef',
    outputToken: APPLE.address,
    expectedOut,
    minOut: (expectedOut * 95n) / 100n,
    etaSeconds: 2,
  };
}

const gasZip = (inputAmount: bigint): GasZipQuote => ({
  contract: '0x9e22ebec84c7e4c4bd6d4ae7ff6f4d436d6d8390',
  shortId: 526,
  inputAmount,
  value: inputAmount * 10n ** 12n,
  expectedOut: 380_000_000_000_000n,
  outDecimals: 18,
  etaSeconds: 1,
});

const buying = (over: Partial<PlannerContext> = {}) =>
  fakeContext({
    resolveToken: async (ref, chainId) => (chainId === CHAIN.robinhood ? APPLE_TOKEN : USDC_ARC),
    priceOf,
    acrossSwapQuote: async (_f, _t, input) => buyQuote(input),
    ...over,
  });

const buy = (over: Record<string, unknown> = {}) =>
  IntentSchema.parse(
    bridgeIntent({ toChainId: CHAIN.robinhood, receive: { kind: 'symbol', symbol: 'AAPL' }, amount: { kind: 'usd', value: '50' }, ...over }),
  );

async function planOk(intent: ReturnType<typeof buy>, ctx: PlannerContext): Promise<Plan> {
  const result = await buildPlan(intent, ctx);
  if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
  return result.plan;
}

describe('buying a stock', () => {
  it('buys it with Arc USDC in one step, for exactly the listed token', async () => {
    let asked: string | null = null;
    const plan = await planOk(
      buy(),
      buying({ acrossSwapQuote: async (_f, _t, input, output) => ((asked = output), buyQuote(input)) }),
    );

    expect(asked).toBe(APPLE.address);
    expect(plan.inflow[0]?.token.address).toBe(APPLE.address);
    expect(plan.route?.provider).toBe('across-swap');
    expect(plan.summary).toMatch(/^Buy \$50\.00 of Apple\. About 0\.146\d* AAPL/);
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('brings the gas to sell it later, when there is none there yet', async () => {
    const plan = await planOk(buy(), buying({ gasZipQuote: async (_f, _t, input) => gasZip(input) }));

    expect(plan.route?.gasTopUp).toEqual({ provider: 'gas.zip' });
    expect(plan.summary).toContain('so you can sell later');
  });

  it('brings none when there is already gas there', async () => {
    const plan = await planOk(
      buy(),
      buying({ gasZipQuote: async (_f, _t, input) => gasZip(input), nativeBalanceUsd: async () => '5' }),
    );

    expect(plan.route?.gasTopUp).toBeUndefined();
  });

  it('refuses a ticker that is not on the list', async () => {
    const result = await buildPlan(buy({ receive: { kind: 'symbol', symbol: 'FAKE' } }), buying());

    expect(result.ok).toBe(false);
  });

  it('says where stocks live when asked for one on another chain', async () => {
    const result = await buildPlan(buy({ toChainId: CHAIN.base }), buying());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.message).toMatch(/Robinhood Chain \(chain 4663\)/);
  });

  it('never sends plain USDC there: there is no USDC on Robinhood Chain', async () => {
    const result = await buildPlan(buy({ receive: undefined }), buying());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.message).toMatch(/no USDC on Robinhood Chain/);
  });
});

describe('slippage, thought through', () => {
  /** A market that holds its price up to $1,000, then gives `bigLossBps` more on anything bigger. */
  const thin = (bigLossBps: bigint) =>
    buying({ acrossSwapQuote: async (_f, _t, input) => buyQuote(input, input > 1_000_000_000n ? 20n + bigLossBps : 20n) });

  const big = buy({ amount: { kind: 'usd', value: '100000' } });
  const rich = { balanceOf: async () => 200_000_000_000n, usdcBalanceUsd: async () => '200000' };

  it('says nothing about a normal trade', async () => {
    const plan = await planOk(buy(), buying());

    expect(plan.warnings.map((w) => w.code)).not.toContain('high_price_impact');
  });

  it('warns, and makes the user confirm, when a big trade moves the price', async () => {
    const ctx = thin(500n);
    const plan = await planOk(big, { ...ctx, ...rich });
    const warning = plan.warnings.find((w) => w.code === 'high_price_impact');

    expect(warning?.severity).toBe('danger');
    expect(warning?.message).toMatch(/About 5% of this goes to price impact/);
    // Said once: not again as a heavy fee.
    expect(plan.warnings.map((w) => w.code)).not.toContain('fee_heavy');
  });

  it('refuses a trade the market cannot take, with the number', async () => {
    const result = await buildPlan(big, { ...thin(1_500n), ...rich });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('price_impact');
      expect(result.failure.message).toMatch(/lose about 15% to the price — there isn't enough trading in Apple/);
    }
  });

  it('is not fooled by a stale price feed — a closed market is not a thin one', async () => {
    // The feed still says $400 (Friday's close, say); the market trades at $340
    // at every size. The trade is fine: nothing to warn about.
    const plan = await planOk(big, {
      ...buying({ priceOf: async (token) => (token.address === APPLE.address ? '400' : '1') }),
      ...rich,
    });

    expect(plan.warnings.map((w) => w.code)).not.toContain('high_price_impact');
  });
});

describe('selling a stock', () => {
  const HALF_A_SHARE = 500_000_000_000_000_000n;

  function sellQuote(inputAmount: bigint): AcrossNativeSwapQuote {
    return {
      periphery: PERIPHERY,
      inputToken: APPLE.address,
      inputAmount,
      data: '0x110560addeadbeef',
      outputToken: USDC_ARC.address,
      // Half a share at $340, less a little.
      expectedOut: 169_800_000n,
      minOut: 166_000_000n,
      etaSeconds: 1,
    };
  }

  const selling = (over: Partial<PlannerContext> = {}) =>
    fakeContext({
      resolveToken: async (ref, chainId) => (chainId === CHAIN.robinhood ? APPLE_TOKEN : USDC_ARC),
      priceOf,
      balanceOf: async (token) => (token.address === APPLE.address ? HALF_A_SHARE : 0n),
      nativeBalanceUsd: async (chainId) => (chainId === CHAIN.robinhood ? '1' : null),
      acrossNativeSwapQuote: async (_f, _t, input, _r, token) => (token === APPLE.address ? sellQuote(input) : null),
      ...over,
    });

  const sell = IntentSchema.parse(
    bridgeIntent({
      fromChainId: CHAIN.robinhood,
      toChainId: CHAIN.arc,
      token: { kind: 'symbol', symbol: 'AAPL' },
      amount: { kind: 'max' },
    }),
  );

  it('approves exactly what it sells, then sells it for Arc USDC', async () => {
    const plan = await planOk(sell, selling());

    expect(plan.calls).toEqual([
      expect.objectContaining({ chainId: CHAIN.robinhood, to: APPLE.address, data: encodeErc20Approve(PERIPHERY, HALF_A_SHARE), value: '0' }),
      expect.objectContaining({ chainId: CHAIN.robinhood, to: PERIPHERY, data: '0x110560addeadbeef', value: '0' }),
    ]);
    expect(plan.inflow[0]).toMatchObject({ amount: '169800000', token: { address: USDC_ARC.address, chainId: CHAIN.arc } });
    expect(plan.summary).toBe('Sell 0.5 Apple ($170.00) for USDC on Arc. About $169.80 arrives in about a second.');
    expect(plan.blockyFee).toBeUndefined();
  });

  it('needs a little ETH there to pay for the sale, and says so', async () => {
    const result = await buildPlan(sell, selling({ nativeBalanceUsd: async () => '0' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('no_gas_route');
  });
});
