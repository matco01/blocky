import { vi, describe, expect, it } from 'vitest';

// The network is chosen as the shared packages load, so this file switches to
// mainnet before anything imports them. Vitest isolates modules per file.
vi.hoisted(() => {
  process.env.BLOCKY_NETWORK = 'mainnet';
});

import { CHAIN, IntentSchema, PlanSchema, type Plan } from '@blocky/shared';
import { DEFAULT_CHAIN, acrossSpokePool, cctpContracts, type AcrossQuote } from '@blocky/wallet-core';
import { acrossDepositCalls, encodeAcrossDepositV3, encodeErc20Approve } from '../src/calls';
import { bestRoute, buildPlan } from '../src/plan';
import { ME, bridgeIntent, fakeContext, tokenOn } from './factories';

/**
 * Finding the best way to move money. On mainnet there is more than one road
 * from Arc to Base — Circle's CCTP and Across — and the planner prices every
 * one and keeps whichever lands the most in the user's wallet.
 */

const USDC_ARC = tokenOn(CHAIN.arc);
const SPOKE = acrossSpokePool(CHAIN.arc)!;
const MESSENGER = cctpContracts(CHAIN.arc)!.tokenMessenger;

function acrossQuote(outputAmount: bigint, over: Partial<AcrossQuote> = {}): AcrossQuote {
  return {
    spokePool: SPOKE,
    inputToken: USDC_ARC.address,
    outputToken: tokenOn(CHAIN.base).address,
    inputAmount: 20_000_000n,
    outputAmount,
    destinationChainId: CHAIN.base,
    exclusiveRelayer: '0x0000000000000000000000000000000000000000',
    quoteTimestamp: 1_790_355_671,
    fillDeadline: 1_790_362_871,
    exclusivityDeadline: 0,
    etaSeconds: 2,
    ...over,
  };
}

const context = (over: Parameters<typeof fakeContext>[0] = {}) =>
  fakeContext({ resolveToken: async () => USDC_ARC, ...over });

async function plan(ctx = context()): Promise<Plan> {
  const intent = IntentSchema.parse(bridgeIntent({ toChainId: CHAIN.base }));
  const result = await buildPlan(intent, ctx);
  if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
  return result.plan;
}

it('runs on mainnet in this file', () => {
  expect(DEFAULT_CHAIN).toBe(CHAIN.arc);
});

describe('choosing the route', () => {
  it('takes Across when it lands more than CCTP', async () => {
    // Across: $19.994305 lands. CCTP: $20 less a $0.054565 ceiling.
    const result = await plan(context({ acrossQuote: async () => acrossQuote(19_994_305n) }));

    expect(result.route).toEqual({ provider: 'across', etaSeconds: 2, feeIsCeiling: false });
    expect(result.inflow[0]?.amount).toBe('19994305');
    expect(result.calls.map((call) => call.to)).toEqual([USDC_ARC.address, SPOKE]);
    expect(result.summary).toBe('Move $20.00 to your wallet on Base. $19.99 arrives in about 2 seconds.');
    expect(PlanSchema.safeParse(result).success).toBe(true);
  });

  it('takes CCTP when it lands more than Across', async () => {
    const result = await plan(context({ acrossQuote: async () => acrossQuote(19_000_000n) }));

    expect(result.route?.provider).toBe('cctp');
    expect(result.calls[1]?.to).toBe(MESSENGER);
  });

  it('falls back to CCTP when Across has no route', async () => {
    expect((await plan(context({ acrossQuote: async () => null }))).route?.provider).toBe('cctp');
  });

  it('falls back to CCTP when Across cannot be reached', async () => {
    const result = await plan(context({ acrossQuote: async () => { throw new Error('503'); } }));

    expect(result.route?.provider).toBe('cctp');
  });

  it('falls back to Across when Circle cannot quote', async () => {
    const result = await plan(
      context({
        bridgeFees: async () => { throw new Error('503'); },
        acrossQuote: async () => acrossQuote(19_990_000n),
      }),
    );

    expect(result.route?.provider).toBe('across');
  });

  it('refuses when no route can be priced', async () => {
    const intent = IntentSchema.parse(bridgeIntent({ toChainId: CHAIN.base }));
    const result = await buildPlan(
      intent,
      context({ bridgeFees: async () => { throw new Error('503'); }, acrossQuote: async () => null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('no_bridge_route');
  });

  it('ignores an Across quote for a different amount than the one being sent', async () => {
    const result = await plan(
      context({ acrossQuote: async () => acrossQuote(25_000_000n, { inputAmount: 30_000_000n }) }),
    );

    expect(result.route?.provider).toBe('cctp');
  });

  it('counts the Across fee as the difference between what leaves and what lands', async () => {
    const result = await plan(context({ acrossQuote: async () => acrossQuote(19_994_305n) }));

    expect(result.fee.breakdown.serviceUsd).toBe('0.005695');
    expect(result.fee.totalUsd).toBe('0.105695');
  });
});

describe('the Across calls', () => {
  it('approves the SpokePool exactly the amount deposited, and pays out to the user', async () => {
    const result = await plan(context({ acrossQuote: async () => acrossQuote(19_994_305n) }));

    expect(result.calls[0]?.data).toBe(encodeErc20Approve(SPOKE, 20_000_000n));
    expect(result.calls[1]?.data).toBe(
      acrossDepositCalls({
        chainId: CHAIN.arc,
        token: USDC_ARC,
        spokePool: SPOKE,
        depositor: ME,
        outputToken: tokenOn(CHAIN.base).address,
        inputAmount: 20_000_000n,
        outputAmount: 19_994_305n,
        destinationChainId: CHAIN.base,
        exclusiveRelayer: '0x0000000000000000000000000000000000000000',
        quoteTimestamp: 1_790_355_671,
        fillDeadline: 1_790_362_871,
        exclusivityDeadline: 0,
        displayAmount: '20',
        destinationName: 'Base',
      })[1]?.data,
    );
  });

  /** Golden vector from viem's ABI encoder: ours must agree byte for byte. */
  it('encodes depositV3 exactly as a standard ABI encoder does', () => {
    expect(
      encodeAcrossDepositV3({
        depositor: '0x2222222222222222222222222222222222222222',
        recipient: '0x2222222222222222222222222222222222222222',
        inputToken: '0x3600000000000000000000000000000000000000',
        outputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        inputAmount: 20_000_000n,
        outputAmount: 19_994_296n,
        destinationChainId: 8453,
        exclusiveRelayer: '0x0000000000000000000000000000000000000000',
        quoteTimestamp: 1_790_355_671,
        fillDeadline: 1_790_362_871,
        exclusivityDeadline: 0,
      }),
    ).toBe(
      '0x7b939232000000000000000000000000222222222222222222222222222222222222222200000000000000000000000022222222222222222222222222222222222222220000000000000000000000003600000000000000000000000000000000000000000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000001312d0000000000000000000000000000000000000000000000000000000000013116b800000000000000000000000000000000000000000000000000000000000021050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006ab6a8d7000000000000000000000000000000000000000000000000000000006ab6c4f7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000000',
    );
  });
});

describe('bestRoute', () => {
  const route = (arrive: bigint, etaSeconds: number) => ({ arrive, etaSeconds });

  it('keeps the route that lands the most', () => {
    expect(bestRoute([route(100_000n, 2), route(200_000n, 30)])?.arrive).toBe(200_000n);
  });

  it('prefers the faster route when the difference is under a tenth of a cent', () => {
    const fast = route(19_999_500n, 2);
    const slow = route(19_999_900n, 30);

    expect(bestRoute([slow, fast])).toBe(fast);
  });

  it('takes the slower route when it is worth it', () => {
    const fast = route(19_990_000n, 2);
    const slow = route(19_999_000n, 30);

    expect(bestRoute([fast, slow])).toBe(slow);
  });

  it('never picks a route that lands nothing', () => {
    expect(bestRoute([route(0n, 1)])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Swapping into the destination's gas token, and gas top-ups                 */
/* -------------------------------------------------------------------------- */

import { NATIVE_TOKEN, encodeGasZipDeposit, gasZipDepositContract, type AcrossSwapQuote, type GasZipQuote } from '@blocky/wallet-core';

const GAS_ZIP = gasZipDepositContract(CHAIN.arc)!;
const ETH_PRICE = '2600';

function gasZipQuote(inputAmount: bigint, expectedOut: bigint): GasZipQuote {
  return { contract: GAS_ZIP, shortId: 57, inputAmount, value: inputAmount * 10n ** 12n, expectedOut, outDecimals: 18, etaSeconds: 1 };
}

function swapQuote(expectedOut: bigint, minOut: bigint): AcrossSwapQuote {
  return { spokePool: SPOKE, inputAmount: 20_000_000n, depositData: '0xad5425c6deadbeef', outputToken: NATIVE_TOKEN, expectedOut, minOut, etaSeconds: 2 };
}

/** ETH at $2,600; USDC at $1. */
const priced = (over: Parameters<typeof fakeContext>[0] = {}) =>
  context({ priceOf: async (token) => (token.address === NATIVE_TOKEN ? ETH_PRICE : '1'), ...over });

async function planFor(overrides: Record<string, unknown>, ctx: ReturnType<typeof fakeContext>) {
  const result = await buildPlan(IntentSchema.parse(bridgeIntent(overrides)), ctx);
  if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
  return result.plan;
}

describe('swapping USDC on Arc into ETH on another chain', () => {
  const ethOnArbitrum = { toChainId: CHAIN.arbitrum, receive: { kind: 'symbol', symbol: 'ETH' } };

  it('takes Gas.zip when it lands more ETH, as one transaction carrying the USDC as value', async () => {
    const plan = await planFor(
      ethOnArbitrum,
      priced({
        gasZipQuote: async (_f, _t, input) => gasZipQuote(input, 7_690_000_000_000_000n),
        acrossSwapQuote: async () => swapQuote(7_600_000_000_000_000n, 7_500_000_000_000_000n),
      }),
    );

    expect(plan.route?.provider).toBe('gas.zip');
    expect(plan.inflow[0]).toMatchObject({ amount: '7690000000000000', token: { address: NATIVE_TOKEN, symbol: 'ETH', chainId: CHAIN.arbitrum } });
    expect(plan.calls).toEqual([
      expect.objectContaining({ to: GAS_ZIP, value: '20000000000000000000', data: encodeGasZipDeposit(57, ME) }),
    ]);
    expect(plan.summary).toBe('Swap $20.00 into ETH on Arbitrum One. About 0.00769 ETH ($19.99) arrives in about a second.');
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('takes the Across swap when it lands more, and records the minimum', async () => {
    const plan = await planFor(
      ethOnArbitrum,
      priced({
        gasZipQuote: async () => null,
        acrossSwapQuote: async () => swapQuote(7_600_000_000_000_000n, 7_480_000_000_000_000n),
      }),
    );

    expect(plan.route).toMatchObject({ provider: 'across-swap', minimumReceived: '7480000000000000' });
    expect(plan.calls.map((call) => call.to)).toEqual([USDC_ARC.address, SPOKE]);
    expect(plan.calls[0]?.data).toBe(encodeErc20Approve(SPOKE, 20_000_000n));
    expect(plan.calls[1]?.data).toBe('0xad5425c6deadbeef');
  });

  it('counts what the swap keeps as its fee, at the live ETH price', async () => {
    // 0.0076 ETH at $2,600 = $19.76 lands for $20.
    const plan = await planFor(
      ethOnArbitrum,
      priced({ acrossSwapQuote: async () => swapQuote(7_600_000_000_000_000n, 7_480_000_000_000_000n) }),
    );

    expect(plan.fee.breakdown.serviceUsd).toBe('0.24');
  });

  it('does not warn about gas there — the user is receiving the gas token itself', async () => {
    const plan = await planFor(ethOnArbitrum, priced({ gasZipQuote: async (_f, _t, input) => gasZipQuote(input, 7_690_000_000_000_000n) }));

    expect(plan.warnings.map((w) => w.code)).not.toContain('destination_no_gas_route');
  });

  it('refuses a token it cannot deliver there, rather than guessing', async () => {
    const intent = IntentSchema.parse(bridgeIntent({ toChainId: CHAIN.arbitrum, receive: { kind: 'symbol', symbol: 'ARB' } }));
    const result = await buildPlan(intent, priced());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('not_implemented');
  });

  it('refuses when no route can deliver it', async () => {
    const result = await buildPlan(IntentSchema.parse(bridgeIntent(ethOnArbitrum)), priced());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('no_bridge_route');
  });
});

describe('a gas top-up alongside a move', () => {
  const withGas = { toChainId: CHAIN.base, includeGas: true };
  const acrossOnly = { acrossQuote: async () => acrossQuote(19_994_305n) };

  it('adds a little ETH when the user has none there, as its own transaction', async () => {
    const plan = await planFor(
      withGas,
      priced({ ...acrossOnly, gasZipQuote: async (_f, _t, input) => gasZipQuote(input, 384_000_000_000_000n) }),
    );

    // 20 transactions at the fake $0.10 fee: a $2 top-up.
    expect(plan.outflow.map((d) => d.amount)).toEqual(['20000000', '2000000']);
    expect(plan.inflow.map((d) => d.token.symbol)).toEqual(['USDC', 'ETH']);
    expect(plan.calls.map((call) => call.to)).toEqual([USDC_ARC.address, SPOKE, GAS_ZIP]);
    expect(plan.calls[2]?.value).toBe('2000000000000000000');
    expect(plan.route?.gasTopUp).toEqual({ provider: 'gas.zip' });
    expect(plan.summary).toMatch(/^Move \$20\.00 to your wallet on Base, plus \$2\.00 of ETH for gas\./);
    expect(plan.warnings.map((w) => w.code)).not.toContain('destination_no_gas_route');
  });

  it('skips the top-up when the user already has gas there', async () => {
    const plan = await planFor(
      withGas,
      priced({ ...acrossOnly, nativeBalanceUsd: async () => '10', gasZipQuote: async (_f, _t, input) => gasZipQuote(input, 1n) }),
    );

    expect(plan.calls).toHaveLength(2);
    expect(plan.route?.gasTopUp).toBeUndefined();
  });

  it('never adds one unasked', async () => {
    const plan = await planFor(
      { toChainId: CHAIN.base },
      priced({ ...acrossOnly, gasZipQuote: async (_f, _t, input) => gasZipQuote(input, 1n) }),
    );

    expect(plan.calls).toHaveLength(2);
  });

  it('still moves the money when no top-up can be quoted, and keeps the warning', async () => {
    const plan = await planFor(withGas, priced({ ...acrossOnly, gasZipQuote: async () => null }));

    expect(plan.calls).toHaveLength(2);
    expect(plan.warnings.map((w) => w.code)).toContain('destination_no_gas_route');
  });

  it('sizes the top-up to the destination, within $1–$5', async () => {
    let asked = 0n;
    await planFor(
      { toChainId: CHAIN.ethereum, includeGas: true },
      priced({
        estimateNetworkFeeUsd: async (chainId) => (chainId === CHAIN.ethereum ? '0.60' : '0.10'),
        acrossQuote: async () => acrossQuote(19_800_000n, { destinationChainId: CHAIN.ethereum }),
        gasZipQuote: async (_f, _t, input) => ((asked = input), gasZipQuote(input, 1n)),
      }),
    );

    // 20 transactions × $0.60 = $12, capped at $5.
    expect(asked).toBe(5_000_000n);
  });
});

/* -------------------------------------------------------------------------- */
/*  Coming home: moving money from another chain back to Arc                   */
/* -------------------------------------------------------------------------- */

import { acrossPeriphery, type AcrossNativeSwapQuote } from '@blocky/wallet-core';

const ETH_ON_ARBITRUM = {
  chainId: CHAIN.arbitrum,
  address: NATIVE_TOKEN,
  symbol: 'ETH',
  name: 'ETH',
  decimals: 18,
  logoUrl: null,
  verified: true,
} as const;

const PERIPHERY = acrossPeriphery(CHAIN.arbitrum)!;

function nativeSwapQuote(inputAmount: bigint): AcrossNativeSwapQuote {
  return {
    periphery: PERIPHERY,
    inputAmount,
    data: '0x110560addeadbeef',
    outputToken: USDC_ARC.address,
    expectedOut: 13_460_000n,
    minOut: 13_360_000n,
    etaSeconds: 1,
  };
}

/** A wallet holding 0.01 ETH on Arbitrum, with Arbitrum gas at $0.10 and ETH at $2,600. */
const onArbitrum = (over: Parameters<typeof fakeContext>[0] = {}) =>
  priced({
    resolveToken: async (ref, chainId) =>
      ref.kind === 'symbol' && ref.symbol === 'ETH' ? ETH_ON_ARBITRUM : tokenOn(chainId as keyof typeof import('@blocky/wallet-core').CHAINS),
    balanceOf: async (token) => (token.address === NATIVE_TOKEN ? 10_000_000_000_000_000n : 50_000_000n),
    nativeBalanceUsd: async (chainId) => (chainId === CHAIN.arbitrum ? '26' : null),
    ...over,
  });

const home = (over: Record<string, unknown>) => ({ fromChainId: CHAIN.arbitrum, toChainId: CHAIN.arc, ...over });

describe('bringing ETH home as USDC', () => {
  const sellEth = home({ token: { kind: 'symbol', symbol: 'ETH' }, amount: { kind: 'token', value: '0.005' } });

  it('sells it through Across in one call carrying the ETH as value', async () => {
    const plan = await planFor(sellEth, onArbitrum({ acrossNativeSwapQuote: async (_f, _t, input) => nativeSwapQuote(input) }));

    expect(plan.calls).toEqual([
      expect.objectContaining({ chainId: CHAIN.arbitrum, to: PERIPHERY, value: '5000000000000000', data: '0x110560addeadbeef' }),
    ]);
    expect(plan.inflow[0]).toMatchObject({ amount: '13460000', token: { address: USDC_ARC.address, chainId: CHAIN.arc } });
    expect(plan.route).toMatchObject({ provider: 'across-swap', minimumReceived: '13360000' });
    expect(plan.fee.paidIn).toBe('native');
    expect(plan.summary).toBe('Swap 0.005 ETH ($13.00) on Arbitrum One into USDC on Arc. About $13.46 arrives in about a second.');
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('for "all of it", keeps back the ETH that pays the gas', async () => {
    let sold = 0n;
    await planFor(
      home({ token: { kind: 'symbol', symbol: 'ETH' }, amount: { kind: 'max' } }),
      onArbitrum({ acrossNativeSwapQuote: async (_f, _t, input) => ((sold = input), nativeSwapQuote(input)) }),
    );

    // 0.01 ETH, less the $0.10 fee at $2,600 — about 0.0000385 ETH.
    expect(sold).toBeLessThan(10_000_000_000_000_000n);
    expect(10_000_000_000_000_000n - sold).toBe(38_461_538_461_539n);
  });

  it('refuses to turn ETH into another gas token — only USDC comes home', async () => {
    const intent = IntentSchema.parse(bridgeIntent(home({ token: { kind: 'symbol', symbol: 'ETH' }, toChainId: CHAIN.base, receive: { kind: 'symbol', symbol: 'ETH' } })));
    const result = await buildPlan(intent, onArbitrum());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('not_implemented');
  });
});

describe('bringing USDC home', () => {
  const moveUsdc = home({ amount: { kind: 'token', value: '20' } });

  it('prices CCTP and Across from the other chain, as separate approve and deposit transactions', async () => {
    const plan = await planFor(
      moveUsdc,
      onArbitrum({ acrossQuote: async () => acrossQuote(19_994_989n, { spokePool: acrossSpokePool(CHAIN.arbitrum)! }) }),
    );

    expect(plan.route?.provider).toBe('across');
    expect(plan.calls.every((call) => call.chainId === CHAIN.arbitrum)).toBe(true);
    expect(plan.summary).toMatch(/^Move \$20\.00 from Arbitrum One to your wallet on Arc\./);
  });

  it('pays gas in ETH there, so it needs ETH there', async () => {
    const intent = IntentSchema.parse(bridgeIntent(moveUsdc));
    const result = await buildPlan(intent, onArbitrum({ nativeBalanceUsd: async () => null }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('no_gas_route');
      expect(result.failure.message).toContain('ETH');
    }
  });

  it('leaves the USDC whole — Arbitrum gas comes from the ETH, not the amount', async () => {
    const plan = await planFor(
      home({ amount: { kind: 'max' } }),
      onArbitrum({ acrossQuote: async (_f, _t, input) => acrossQuote(input - 5_000n, { inputAmount: input, spokePool: acrossSpokePool(CHAIN.arbitrum)! }) }),
    );

    expect(plan.outflow[0]?.amount).toBe('50000000');
  });
});

describe('when the money there is not USDC', () => {
  it('says what is there instead, rather than just "not enough"', async () => {
    const intent = IntentSchema.parse(bridgeIntent(home({ amount: { kind: 'max' } })));
    const result = await buildPlan(intent, onArbitrum({ balanceOf: async (token) => (token.address === NATIVE_TOKEN ? 10n ** 16n : 0n) }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('insufficient_balance');
      expect(result.failure.message).toBe(
        "You don't have any USDC on Arbitrum One. You do have ETH there ($26.00) — that can come home as USDC too.",
      );
    }
  });
});
