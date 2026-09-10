import { CHAIN, IntentSchema, PlanSchema, evaluatePolicy, DEFAULT_POLICY } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/plan';
import {
  ALICE,
  KNOWN_RECIPIENT,
  fakeContext,
  tokenOn,
  transferIntent,
  USDC_BASE_SEPOLIA,
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
    expect(plan.calls[0]?.to).toBe(USDC_BASE_SEPOLIA.address);
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

  it('costs nothing to send USDC, because Gateway settles it gas-free', async () => {
    const plan = await planOk();

    expect(plan.fee.totalUsd).toBe('0');
    expect(plan.fee.paidIn).toBe('sponsored');
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

  it('sends the whole balance for max', async () => {
    const plan = await planOk({ amount: { kind: 'max' } });

    expect(plan.outflow[0]?.amount).toBe('1000000000');
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

  it('sends the entire balance on a max USDC send, because Gateway charges nothing', async () => {
    // No fee means nothing to reserve. The reserve path in the planner only
    // engages when gas is taken from the same token being sent, which today
    // cannot happen for USDC — every configured chain has Gateway, so a USDC
    // transfer always settles on the gas-free tier. It stays in place because
    // adding a non-Gateway chain would make it live again.
    const plan = await planOk(
      { amount: { kind: 'max' } },
      fakeContext({ estimateNetworkFeeUsd: async () => '1' }),
    );

    expect(plan.fee.totalUsd).toBe('0');
    expect(plan.outflow[0]?.amount).toBe('1000000000');
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
      fakeContext({ resolveToken: async () => ({ ...USDC_BASE_SEPOLIA, verified: false }) }),
    );

    const warning = plan.warnings.find((w) => w.code === 'unverified_token');
    expect(warning?.severity).toBe('danger');
  });

  it('warns when no dry run was available', async () => {
    const plan = await planOk();

    expect(codes(plan)).toContain('simulation_failed');
  });

  it('says nothing about simulation when it succeeded', async () => {
    const plan = await planOk(
      {},
      fakeContext({
        simulate: async () => ({ status: 'success', revertReason: null, actualInflow: null }),
      }),
    );

    expect(codes(plan)).not.toContain('simulation_failed');
  });

  it('treats a reverting simulation as danger', async () => {
    const plan = await planOk(
      {},
      fakeContext({
        simulate: async () => ({
          status: 'reverted',
          revertReason: 'ERC20: insufficient allowance',
          actualInflow: null,
        }),
      }),
    );

    const warning = plan.warnings.find((w) => w.code === 'simulation_failed');
    expect(warning?.severity).toBe('danger');
    expect(warning?.message).toContain('insufficient allowance');
  });
});

describe('the destination-gas warning', () => {
  it('stays quiet when sending to someone else on a chain without a paymaster', async () => {
    // Whether the recipient can act on Polygon is their business.
    const plan = await planOk(
      { chainId: CHAIN.polygon },
      fakeContext({ resolveToken: async () => tokenOn(CHAIN.polygon) }),
    );

    expect(codes(plan)).not.toContain('destination_no_gas_route');
  });

  it('warns on a self-transfer to a chain the user cannot act on', async () => {
    const plan = await planOk(
      { chainId: CHAIN.polygon, recipient: { kind: 'self' } },
      fakeContext({
        resolveToken: async () => tokenOn(CHAIN.polygon),
        resolveRecipient: async () => ({ ...KNOWN_RECIPIENT, display: 'your wallet' }),
      }),
    );

    const warning = plan.warnings.find((w) => w.code === 'destination_no_gas_route');
    expect(warning?.severity).toBe('warn');
    expect(warning?.message).toContain('Polygon');
  });

  it('stays quiet on Base, where Circle Paymaster is deployed', async () => {
    const plan = await planOk(
      { chainId: CHAIN.base, recipient: { kind: 'self' } },
      fakeContext({ resolveToken: async () => tokenOn(CHAIN.base) }),
    );

    expect(codes(plan)).not.toContain('destination_no_gas_route');
  });

  it('stays quiet when the user holds native token there', async () => {
    const plan = await planOk(
      { chainId: CHAIN.polygon, recipient: { kind: 'self' } },
      fakeContext({
        resolveToken: async () => tokenOn(CHAIN.polygon),
        hasNativeBalance: async () => true,
      }),
    );

    expect(codes(plan)).not.toContain('destination_no_gas_route');
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

  it('refuses a bridge', async () => {
    const bridge = IntentSchema.parse({
      type: 'bridge',
      token: { kind: 'symbol', symbol: 'USDC' },
      amount: { kind: 'usd', value: '20' },
      toChainId: CHAIN.base,
      rationale: 'Move $20 to Base.',
    });

    const result = await buildPlan(bridge, fakeContext());

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

    // $20, known recipient, under the $25 threshold: this auto-executes. The
    // missing dry run rides along as a `warn`, and `evaluatePolicy` only
    // escalates on `danger` — see the note in the README about that.
    expect(decision.outcome).toBe('auto_execute');
    expect(decision.outflowUsd).toBe('20');
  });

  it('forces confirmation once a danger-severity warning is attached', async () => {
    const plan = await planOk(
      {},
      fakeContext({ resolveToken: async () => ({ ...USDC_BASE_SEPOLIA, verified: false }) }),
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
