import { vi, describe, expect, it } from 'vitest';

vi.hoisted(() => {
  process.env.BLOCKY_NETWORK = 'mainnet';
});

import { CHAIN, IntentSchema, PlanSchema, type Plan, type ResolvedToken } from '@blocky/shared';
import {
  NATIVE_TOKEN,
  acrossPeriphery,
  acrossSpokePool,
  type AcrossNativeSwapQuote,
  type AcrossSwapQuote,
} from '@blocky/wallet-core';
import { encodeErc20Approve } from '../src/calls';
import type { PlannerContext } from '../src/context';
import { buildPlan } from '../src/plan';
import { bridgeIntent, fakeContext, tokenOn } from './factories';

/**
 * Any token, by its contract address: the memecoin case. Blocky can't vouch
 * for it, so it says so — and before anyone buys, it checks the token can be
 * sold again, because some can't.
 */

const USDC_ARC = tokenOn(CHAIN.arc);
const DEGEN = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed' as const;
const DEGEN_TOKEN: ResolvedToken = {
  chainId: CHAIN.base,
  address: DEGEN,
  symbol: 'DEGEN',
  name: 'Degen',
  decimals: 18,
  logoUrl: null,
  // Named by address: never on the curated list.
  verified: false,
};

/** $20 of DEGEN at $0.001: 20,000 tokens, less a little. */
const buyQuote = (inputAmount: bigint): AcrossSwapQuote => ({
  spokePool: acrossSpokePool(CHAIN.arc)!,
  inputAmount,
  depositData: '0xad5425c6deadbeef',
  outputToken: DEGEN,
  expectedOut: (inputAmount * 10n ** 12n * 998n) / 1_000n * 1_000n,
  minOut: (inputAmount * 10n ** 12n * 950n) / 1_000n * 1_000n,
  etaSeconds: 2,
});

const sellBack = (usdcOut: bigint): AcrossNativeSwapQuote => ({
  periphery: acrossPeriphery(CHAIN.base)!,
  inputToken: DEGEN,
  inputAmount: 1n,
  data: '0x110560addeadbeef',
  outputToken: USDC_ARC.address,
  expectedOut: usdcOut,
  minOut: usdcOut,
  etaSeconds: 2,
});

const buying = (over: Partial<PlannerContext> = {}) =>
  fakeContext({
    resolveToken: async (ref) => (ref.kind === 'address' ? DEGEN_TOKEN : USDC_ARC),
    priceOf: async (token) => (token.address === DEGEN ? '0.001' : '1'),
    acrossSwapQuote: async (_f, _t, input) => buyQuote(input),
    // Selling it straight back returns $19.80 of the $20.
    acrossNativeSwapQuote: async () => sellBack(19_800_000n),
    ...over,
  });

const buy = (over: Record<string, unknown> = {}) =>
  IntentSchema.parse(
    bridgeIntent({
      toChainId: CHAIN.base,
      receive: { kind: 'address', address: DEGEN, chainId: CHAIN.base },
      amount: { kind: 'usd', value: '20' },
      rationale: 'Buy $20 of DEGEN on Base.',
      ...over,
    }),
  );

async function planOk(intent = buy(), ctx = buying()): Promise<Plan> {
  const result = await buildPlan(intent, ctx);
  if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
  return result.plan;
}

const codes = (plan: Plan) => plan.warnings.map((w) => w.code);

describe('buying a token by its contract', () => {
  it('buys exactly that contract, and says Blocky cannot vouch for it', async () => {
    let asked: string | null = null;
    const plan = await planOk(buy(), buying({ acrossSwapQuote: async (_f, _t, input, output) => ((asked = output), buyQuote(input)) }));

    expect(asked).toBe(DEGEN);
    expect(plan.inflow[0]?.token.address).toBe(DEGEN);
    expect(plan.summary).toMatch(/^Buy \$20\.00 of DEGEN/);
    expect(plan.warnings.find((w) => w.code === 'unverified_token')?.severity).toBe('danger');
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('stays quiet about selling when the token sells back fine', async () => {
    expect(codes(await planOk())).not.toContain('unsellable');
  });

  it('warns when there is no way to sell it back — a honeypot looks like this', async () => {
    const plan = await planOk(buy(), buying({ acrossNativeSwapQuote: async () => null }));
    const warning = plan.warnings.find((w) => w.code === 'unsellable');

    expect(warning?.severity).toBe('danger');
    expect(warning?.message).toMatch(/couldn't find a way to sell DEGEN back/);
  });

  it('warns when selling straight back would lose a lot — a token tax, or a thin market', async () => {
    const plan = await planOk(buy(), buying({ acrossNativeSwapQuote: async () => sellBack(14_000_000n) }));

    expect(plan.warnings.find((w) => w.code === 'unsellable')?.message).toMatch(/return about \$14\.00 of \$20\.00 — 30% lost/);
  });

  it('never looks up a token by a name it does not list — it has to come with its address', async () => {
    const result = await buildPlan(buy({ receive: { kind: 'symbol', symbol: 'DEGEN' } }), buying());

    expect(result.ok).toBe(false);
  });
});

describe('selling a token back', () => {
  const selling = fakeContext({
    resolveToken: async (_ref, chainId) => (chainId === CHAIN.base ? DEGEN_TOKEN : USDC_ARC),
    priceOf: async (token) => (token.address === DEGEN ? '0.001' : '1'),
    balanceOf: async () => 20_000n * 10n ** 18n,
    nativeBalanceUsd: async () => '1',
    acrossNativeSwapQuote: async (_f, _t, input, _r, token) => (token === DEGEN ? { ...sellBack(19_800_000n), inputAmount: input } : null),
  });

  it('approves exactly what it sells, then sells it for Arc USDC', async () => {
    const plan = await planOk(
      IntentSchema.parse(
        bridgeIntent({
          fromChainId: CHAIN.base,
          toChainId: CHAIN.arc,
          token: { kind: 'address', address: DEGEN, chainId: CHAIN.base },
          amount: { kind: 'max' },
          rationale: 'Sell all my DEGEN on Base back to Arc.',
        }),
      ),
      selling,
    );

    expect(plan.calls.map((call) => call.to)).toEqual([DEGEN, acrossPeriphery(CHAIN.base)]);
    expect(plan.calls[0]?.data).toBe(encodeErc20Approve(acrossPeriphery(CHAIN.base)!, 20_000n * 10n ** 18n));
    expect(plan.calls[1]?.value).toBe('0');
    expect(plan.summary).toMatch(/^Sell 20000 DEGEN/);
    expect(plan.blockyFee).toBeUndefined();
  });
});

it('is never confused with the gas token', () => {
  expect(DEGEN).not.toBe(NATIVE_TOKEN);
});
