import { CHAIN, DEFAULT_POLICY, IntentSchema, PlanSchema, evaluatePolicy, type Plan } from '@blocky/shared';
import { cctpContracts } from '@blocky/wallet-core';
import { describe, expect, it } from 'vitest';
import { encodeDepositForBurnWithHook, encodeErc20Approve } from '../src/calls';
import { buildPlan } from '../src/plan';
import { ME, bridgeIntent, fakeContext, tokenOn } from './factories';

/**
 * Moving USDC from Arc to another chain. The user pays every fee in Arc USDC —
 * Arc gas for the burn, and Circle's transfer fee out of the amount — and the
 * destination needs nothing from them. What these tests pin down: exactly how
 * much is burned and how much arrives, that it can only ever arrive at the
 * user's own address, and that they are told when they won't be able to move
 * it again without that chain's gas token.
 */

const MESSENGER = cctpContracts(CHAIN.arcTestnet)!.tokenMessenger;
const HOOK = '0x636374702d666f72776172640000000000000000000000000000000000000000';

function bridge(overrides: Record<string, unknown> = {}) {
  const parsed = IntentSchema.safeParse(bridgeIntent(overrides));
  if (!parsed.success) throw new Error(`Bad test intent: ${parsed.error.message}`);
  return parsed.data;
}

async function planOk(overrides = {}, ctx = fakeContext()): Promise<Plan> {
  const result = await buildPlan(bridge(overrides), ctx);
  if (!result.ok) throw new Error(`Expected a plan, got ${result.failure.code}: ${result.failure.message}`);
  return result.plan;
}

async function failure(overrides = {}, ctx = fakeContext()) {
  const result = await buildPlan(bridge(overrides), ctx);
  if (result.ok) throw new Error('Expected a refusal');
  return result.failure;
}

const codes = (plan: Plan) => plan.warnings.map((w) => w.code);

describe('the calldata', () => {
  /** Golden vectors from viem's ABI encoder: ours must agree byte for byte. */
  it('encodes approve exactly as a standard ABI encoder does', () => {
    expect(encodeErc20Approve(MESSENGER, 20_060_000n)).toBe(
      '0x095ea7b30000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000000000000000000000000000000000000001321760',
    );
  });

  it('encodes depositForBurnWithHook exactly as a standard ABI encoder does', () => {
    expect(
      encodeDepositForBurnWithHook({
        amount: 20_060_000n,
        destinationDomain: 6,
        mintRecipient: '0x2222222222222222222222222222222222222222',
        burnToken: '0x3600000000000000000000000000000000000000',
        maxFee: 60_000n,
        minFinalityThreshold: 1000,
        hookData: HOOK,
      }),
    ).toBe(
      '0x779b432d00000000000000000000000000000000000000000000000000000000013217600000000000000000000000000000000000000000000000000000000000000006000000000000000000000000222222222222222222222222222222222222222200000000000000000000000036000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ea6000000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000020636374702d666f72776172640000000000000000000000000000000000000000',
    );
  });
});

describe('the happy path', () => {
  it('produces a plan that satisfies the shared schema', async () => {
    expect(PlanSchema.safeParse(await planOk()).success).toBe(true);
  });

  it('sends the amount asked for, and shows what arrives after the transfer fee', async () => {
    const plan = await planOk();

    expect(plan.intentType).toBe('bridge');
    expect(plan.outflow[0]?.amount).toBe('20000000');
    // $20 less the $0.054565 forwarding fee ceiling — the floor of what lands.
    expect(plan.inflow[0]?.amount).toBe('19945435');
    expect(plan.inflow[0]?.token.chainId).toBe(CHAIN.baseSepolia);
    expect(plan.inflow[0]?.token.address).toBe(tokenOn(CHAIN.baseSepolia).address);
    expect(plan.route).toEqual({ provider: 'cctp', etaSeconds: 30, feeIsCeiling: true });
  });

  it('approves exactly what it burns, then burns it to the user on the destination', async () => {
    const plan = await planOk();

    expect(plan.calls.map((call) => call.to)).toEqual([tokenOn(CHAIN.arcTestnet).address, MESSENGER]);
    expect(plan.calls[0]?.data).toBe(encodeErc20Approve(MESSENGER, 20_000_000n));
    expect(plan.calls[1]?.data).toBe(
      encodeDepositForBurnWithHook({
        amount: 20_000_000n,
        destinationDomain: 6,
        mintRecipient: ME,
        burnToken: tokenOn(CHAIN.arcTestnet).address,
        maxFee: 54_565n,
        minFinalityThreshold: 1000,
        hookData: HOOK,
      }),
    );
    expect(plan.calls.every((call) => call.chainId === CHAIN.arcTestnet && call.value === '0')).toBe(true);
  });

  it('shows one fee: Arc gas plus the transfer fee ceiling', async () => {
    const plan = await planOk();

    expect(plan.fee.totalUsd).toBe('0.154565');
    expect(plan.fee.breakdown).toEqual({ networkUsd: '0.1', paymasterUsd: '0', serviceUsd: '0.054565' });
    expect(plan.summary).toBe('Move $20.00 to your wallet on Base Sepolia. At least $19.95 arrives in about 30 seconds.');
  });

  it('has no third-party recipient to vet: it is the user moving their own money', async () => {
    expect((await planOk()).recipient).toBeNull();
  });
});

describe('how much', () => {
  it('for "everything", burns the whole spendable balance and delivers it net of fees', async () => {
    // 1,000 USDC, less $0.10 of Arc gas.
    const plan = await planOk({ amount: { kind: 'max' } });

    expect(plan.calls[0]?.data).toBe(encodeErc20Approve(MESSENGER, 999_900_000n));
    expect(plan.inflow[0]?.amount).toBe(String(999_900_000n - 54_565n));
  });

  it('refuses when the amount plus the Arc fee does not fit', async () => {
    const result = await failure({ amount: { kind: 'usd', value: '999.95' } });

    expect(result.code).toBe('insufficient_balance');
  });

  it('refuses "everything" when the fees would take all of it, and says why', async () => {
    const result = await failure(
      { amount: { kind: 'max' } },
      fakeContext({ balanceOf: async () => 150_000n, usdcBalanceUsd: async () => '0.15' }),
    );

    expect(result.code).toBe('no_bridge_route');
    expect(result.message).toMatch(/too little/);
  });
});

describe('the destination', () => {
  it('warns that the money cannot move again without the gas token there', async () => {
    const plan = await planOk();
    const warning = plan.warnings.find((w) => w.code === 'destination_no_gas_route');

    expect(warning?.severity).toBe('warn');
    expect(warning?.message).toContain('ETH');
    expect(warning?.message).toContain('Base Sepolia');
  });

  it('stays quiet when the user already holds enough gas there', async () => {
    const plan = await planOk({}, fakeContext({ nativeBalanceUsd: async () => '5' }));

    expect(codes(plan)).not.toContain('destination_no_gas_route');
  });

  it('still warns when the gas balance there cannot be read', async () => {
    const plan = await planOk({}, fakeContext({ nativeBalanceUsd: async () => { throw new Error('rpc down'); } }));

    expect(codes(plan)).toContain('destination_no_gas_route');
  });
});

describe('what it refuses', () => {
  it('moves only USDC', async () => {
    const result = await failure(
      { token: { kind: 'symbol', symbol: 'EURC' } },
      fakeContext({ resolveToken: async () => ({ ...tokenOn(CHAIN.arcTestnet), address: '0x89b50855aa3be2f677cd6303cec089b5f319d72a', symbol: 'EURC' }) }),
    );

    expect(result.code).toBe('not_implemented');
  });

  it('does not "move" money to the chain it is already on', async () => {
    expect((await failure({ toChainId: CHAIN.arcTestnet })).code).toBe('no_bridge_route');
  });

  it('does not cross from testnet to mainnet', async () => {
    expect((await failure({ toChainId: CHAIN.base })).code).toBe('no_bridge_route');
  });

  it('only moves money out of Arc, where the app can sign', async () => {
    expect((await failure({ fromChainId: CHAIN.baseSepolia, toChainId: CHAIN.arbitrumSepolia })).code).toBe('not_implemented');
  });

  it('says it is unavailable, rather than guessing, when Circle cannot quote the fee', async () => {
    const result = await failure({}, fakeContext({ bridgeFees: async () => { throw new Error('503'); } }));

    expect(result.code).toBe('no_bridge_route');
  });

  it('refuses when Arc USDC cannot cover the gas for the burn', async () => {
    const result = await failure({}, fakeContext({ usdcBalanceUsd: async () => '0.05' }));

    expect(result.code).toBe('no_gas_route');
  });
});

describe('handing off to the policy engine', () => {
  it('counts everything leaving the wallet — the amount and every fee — against the limits', async () => {
    const decision = evaluatePolicy({
      policy: { ...DEFAULT_POLICY, enabled: true },
      plan: await planOk(),
      spentTodayUsd: '0',
    });

    expect(decision.outflowUsd).toBe('20.154565');
    // The destination warning is a `warn`: worth reading, not a reason to force a review.
    expect(decision.outcome).toBe('auto_execute');
  });
});
