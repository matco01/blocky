import { CHAIN, IntentSchema, PlanSchema, evaluatePolicy, DEFAULT_POLICY } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/plan';
import {
  ALICE,
  KNOWN_RECIPIENT,
  fakeContext,
  tokenOn,
  transferIntent,
  USDC_ARC,
} from './factories';

/**
 * The planner is where a sentence becomes a transaction. These tests are the
 * specification for that conversion — particularly the parts that decide
 * whether the user is warned, and the parts that decide how much leaves.
 */

/** Parse through the real schema, so tests can never use an intent the model couldn't produce. */
function intent(overrides: Record<string, unknown> = {}) {
  const parsed = IntentSchema.safeParse(transferIntent(overrides));
  if (!parsed.success) throw new Error(`Bad test intent: ${parsed.error.message}`);
  return parsed.data;
}

async function planOk(overrides = {}, ctx = fakeContext()) {
  const result = await buildPlan(intent(overrides), ctx);
  if (!result.ok) throw new Error(`Expected a plan, got ${result.failure.code}`);
  return result.plan;
}

describe('the happy path', () => {
  it('produces a plan that satisfies the shared schema', async () => {
    const plan = await planOk();

    // If this fails, the API and the app cannot trust the contract either.
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it('converts a USD amount into exact token base units', async () => {
    const plan = await planOk();

    // $20 of a $1 token, 6 decimals.
    expect(plan.outflow[0]?.amount).toBe('20000000');
    expect(plan.outflow[0]?.displayAmount).toBe('20');
    expect(plan.outflow[0]?.usdValue).toBe('20');
  });

  it('builds exactly one ERC-20 transfer call, to the token contract', async () => {
    const plan = await planOk();

    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0]?.to).toBe(USDC_ARC.address);
    expect(plan.calls[0]?.value).toBe('0');
    // selector + recipient + amount
    expect(plan.calls[0]?.data).toBe(
      `0xa9059cbb${ALICE.slice(2).padStart(64, '0')}${(20_000_000n).toString(16).padStart(64, '0')}`,
    );
  });

  it('writes its own summary rather than echoing the model', async () => {
    const plan = await planOk({ rationale: 'Totally unrelated claim.' });

    expect(plan.modelRationale).toBe('Totally unrelated claim.');
    expect(plan.summary).toContain('20 USDC');
    expect(plan.summary).toContain('alice.eth');
    expect(plan.summary).not.toContain('Totally unrelated');
  });

  it('pays gas in USDC on Arc, with no paymaster surcharge', async () => {
    const plan = await planOk();

    // An earlier version charged $0 here on the false premise that Gateway
    // settles transfers gas-free. A real transfer costs gas; the fee says so.
    expect(plan.fee.totalUsd).toBe('0.1');
    expect(plan.fee.paidIn).toBe('usdc');
    expect(plan.fee.breakdown.paymasterUsd).toBe('0');
  });

  it('expires, so a stale quote cannot be executed', async () => {
    const plan = await planOk();

    expect(new Date(plan.expiresAt).getTime()).toBeGreaterThan(new Date(plan.createdAt).getTime());
  });
});

describe('amounts', () => {
  it('takes a token-denominated amount literally', async () => {
    const plan = await planOk({ amount: { kind: 'token', value: '12.5' } });

    expect(plan.outflow[0]?.amount).toBe('12500000');
  });

  it('leaves the fee behind on a max send, since gas comes out of the same USDC', async () => {
    const plan = await planOk({ amount: { kind: 'max' } });

    // 1,000 USDC minus the $0.10 fee.
    expect(plan.outflow[0]?.amount).toBe('999900000');
  });

  /**
   * The bug this replaced: the fee was only reserved for "max", so sending your
   * exact balance planned cleanly and then failed on-chain. On Arc gas always
   * comes out of USDC, which made that every user's last send.
   */
  it('refuses a fixed amount that leaves nothing to pay the fee with', async () => {
    const result = await buildPlan(
      intent({ amount: { kind: 'token', value: '1000' } }),
      fakeContext(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('insufficient_balance');
  });

  it('allows a fixed amount that leaves exactly enough for the fee', async () => {
    const plan = await planOk({ amount: { kind: 'token', value: '999.9' } });

    expect(plan.outflow[0]?.amount).toBe('999900000');
  });

  it('refuses to spend more than the balance', async () => {
    const result = await buildPlan(intent({ amount: { kind: 'usd', value: '5000' } }), fakeContext());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('insufficient_balance');
  });

  it('will not convert a USD amount for an unpriced token', async () => {
    // Guessing here would be a five-orders-of-magnitude error, not a rounding one.
    const result = await buildPlan(
      intent({ amount: { kind: 'usd', value: '20' } }),
      fakeContext({ priceOf: async () => null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('unpriced_amount');
  });

  it('still sends an unpriced token when the amount is in token units', async () => {
    const plan = await planOk(
      { amount: { kind: 'token', value: '5' } },
      fakeContext({ priceOf: async () => null }),
    );

    expect(plan.outflow[0]?.amount).toBe('5000000');
    expect(plan.outflow[0]?.usdValue).toBeNull();
  });

  it('rounds a fractional fee reserve up, never down', async () => {
    // A $0.000001 fee at a $3 unit price is a third of a base unit. Rounding
    // down would reserve nothing and leave the fee unpayable.
    const plan = await planOk(
      { amount: { kind: 'max' } },
      fakeContext({
        estimateNetworkFeeUsd: async () => '0.000001',
        priceOf: async () => '3',
      }),
    );

    expect(plan.outflow[0]?.amount).toBe('999999999');
  });
});

describe('resolution failures ask rather than guess', () => {
  it('fails on an unknown token instead of picking something close', async () => {
    const result = await buildPlan(intent(), fakeContext({ resolveToken: async () => null }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('unknown_token');
      expect(result.failure.message).toContain('USDC');
    }
  });

  it('fails on an unresolvable recipient', async () => {
    const result = await buildPlan(intent(), fakeContext({ resolveRecipient: async () => null }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('unknown_recipient');
  });
});

describe('warnings', () => {
  it('flags a first-time recipient', async () => {
    const plan = await planOk(
      {},
      fakeContext({ resolveRecipient: async () => ({ ...KNOWN_RECIPIENT, known: false }) }),
    );

    expect(codes(plan)).toContain('new_recipient');
  });

  it('flags a sanctioned address as danger', async () => {
    const plan = await planOk({}, fakeContext({ isAddressFlagged: async () => true }));

    const flagged = plan.warnings.find((w) => w.code === 'address_flagged');
    expect(flagged?.severity).toBe('danger');
  });

  it('flags a contract recipient', async () => {
    const plan = await planOk(
      {},
      fakeContext({ resolveRecipient: async () => ({ ...KNOWN_RECIPIENT, isContract: true }) }),
    );

    expect(codes(plan)).toContain('recipient_is_contract');
  });

  it('flags an unverified token as danger', async () => {
    const plan = await planOk(
      {},
      fakeContext({ resolveToken: async () => ({ ...USDC_ARC, verified: false }) }),
    );

    const warning = plan.warnings.find((w) => w.code === 'unverified_token');
    expect(warning?.severity).toBe('danger');
  });

  it('never dry-runs a plain transfer, even when the context can simulate one', async () => {
    // A transfer has no logic beyond what the balance and gas checks already
    // cover, so simulating one would tell the user nothing real — it's the
    // swap path that needs this, once there's router logic that can revert.
    let called = false;
    const plan = await planOk(
      {},
      fakeContext({
        simulate: async () => {
          called = true;
          return { status: 'success', revertReason: null, actualInflow: null };
        },
      }),
    );

    expect(called).toBe(false);
    expect(plan.simulation).toBeNull();
    expect(codes(plan)).not.toContain('simulation_failed');
  });
});

describe('where a send can come from', () => {
  /**
   * From wherever the money is: someone holding USDC on Base Sepolia can pay
   * from there, and the recipient receives it there — with gas paid in that
   * chain's own token, which they have to hold.
   */
  it('sends from another chain, where the money is, and says so', async () => {
    const plan = await planOk(
      { chainId: CHAIN.baseSepolia },
      fakeContext({ resolveToken: async () => tokenOn(CHAIN.baseSepolia), nativeBalanceUsd: async () => '5' }),
    );

    expect(plan.calls).toEqual([expect.objectContaining({ chainId: CHAIN.baseSepolia, to: tokenOn(CHAIN.baseSepolia).address, value: '0' })]);
    expect(plan.summary).toMatch(/ on Base Sepolia\./);
  });

  it("sends a chain's own gas token as plain value, keeping back what the fee could be", async () => {
    const ETH = { ...USDC_ARC, chainId: CHAIN.baseSepolia, address: '0x0000000000000000000000000000000000000000' as const, symbol: 'ETH', name: 'ETH', decimals: 18 };
    const plan = await planOk(
      { chainId: CHAIN.baseSepolia, token: { kind: 'symbol', symbol: 'ETH' }, amount: { kind: 'max' } },
      fakeContext({
        resolveToken: async () => ETH,
        priceOf: async () => '2600',
        balanceOf: async () => 10_000_000_000_000_000n,
        nativeBalanceUsd: async () => '26',
      }),
    );
    const [call] = plan.calls;

    expect(call).toMatchObject({ chainId: CHAIN.baseSepolia, to: ALICE, data: '0x' });
    // 0.01 ETH, less three times the $0.10 fee at $2,600.
    expect(10_000_000_000_000_000n - BigInt(call!.value)).toBe(38_461_538_461_539n * 3n);
  });

  it("refuses to send off Arc without that chain's gas token", async () => {
    const result = await buildPlan(
      intent({ chainId: CHAIN.baseSepolia }),
      fakeContext({ resolveToken: async () => tokenOn(CHAIN.baseSepolia), nativeBalanceUsd: async () => '0' }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('no_gas_route');
  });

  it('refuses when Arc USDC cannot cover the fee', async () => {
    const result = await buildPlan(intent(), fakeContext({ usdcBalanceUsd: async () => '0.05' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('no_gas_route');
  });

  it('never carries the destination warning — that is for money moving between chains', async () => {
    expect(codes(await planOk())).not.toContain('destination_no_gas_route');
  });
});

describe('what is not built yet fails loudly', () => {
  it('refuses a swap rather than half-doing one', async () => {
    const swap = IntentSchema.parse({
      type: 'swap',
      from: { kind: 'symbol', symbol: 'USDC' },
      to: { kind: 'symbol', symbol: 'ETH' },
      amount: { kind: 'usd', value: '20' },
      rationale: 'Buy $20 of ETH.',
    });

    const result = await buildPlan(swap, fakeContext());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('not_implemented');
  });

});

describe('handing off to the policy engine', () => {
  it('produces a plan the policy engine can evaluate end to end', async () => {
    const plan = await planOk();

    const decision = evaluatePolicy({
      policy: { ...DEFAULT_POLICY, enabled: true, recipientAllowlist: [] },
      plan,
      spentTodayUsd: '0',
    });

    // $20 plus a $0.10 fee, known recipient, under the $25 threshold: this
    // auto-executes. The missing dry run rides along as a `warn`, and
    // `evaluatePolicy` only escalates on `danger` — see the README about that.
    expect(decision.outcome).toBe('auto_execute');
    expect(decision.outflowUsd).toBe('20.1');
  });

  it('forces confirmation once a danger-severity warning is attached', async () => {
    const plan = await planOk(
      {},
      fakeContext({ resolveToken: async () => ({ ...USDC_ARC, verified: false }) }),
    );

    const decision = evaluatePolicy({
      policy: { ...DEFAULT_POLICY, enabled: true, tokenAllowlist: null },
      plan,
      spentTodayUsd: '0',
    });

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('dangerous_warning');
  });

  it('is denied when it breaches the per-transaction cap', async () => {
    const plan = await planOk({ amount: { kind: 'usd', value: '500' } });

    const decision = evaluatePolicy({
      policy: { ...DEFAULT_POLICY, enabled: true },
      plan,
      spentTodayUsd: '0',
    });

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons.map((r) => r.code)).toContain('over_per_tx_cap');
  });
});

function codes(plan: { warnings: Array<{ code: string }> }): string[] {
  return plan.warnings.map((w) => w.code);
}

describe("Blocky's fee", () => {
  it('never touches a plain send', async () => {
    const plan = await planOk({}, fakeContext({ blockyFee: () => ({ recipient: '0x7777777777777777777777777777777777777777', bps: 50 }) }));

    expect(plan.blockyFee).toBeUndefined();
    expect(plan.calls).toHaveLength(1);
  });
});
