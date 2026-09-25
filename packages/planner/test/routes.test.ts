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
