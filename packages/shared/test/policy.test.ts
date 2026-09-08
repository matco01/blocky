import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, evaluatePolicy, type Policy } from '../src';
import { delta, makePlan, NOW, recipient, SKETCHY_TOKEN, USDC, warning } from './factories';

/**
 * The highest-value tests in the repo.
 *
 * An agent that loses someone's money once is a dead product, and this function
 * is the thing standing in the way. Every branch gets a test, and the
 * adversarial cases matter more than the happy path.
 */

/** A policy that would happily auto-execute the default plan. */
const PERMISSIVE: Policy = {
  ...DEFAULT_POLICY,
  enabled: true,
  autoExecuteThresholdUsd: '50',
  perTxCapUsd: '500',
  dailyCapUsd: '1000',
  recipientAllowlist: ['0x1111111111111111111111111111111111111111'],
};

const evaluate = (policy: Policy, plan = makePlan(), spentTodayUsd = '0') =>
  evaluatePolicy({ policy, plan, spentTodayUsd, now: NOW });

describe('the happy path', () => {
  it('auto-executes a small transfer to a known recipient', () => {
    const decision = evaluate(PERMISSIVE);

    expect(decision.outcome).toBe('auto_execute');
    expect(decision.reasons).toEqual([]);
    // $10 outflow + $0.01 fee.
    expect(decision.outflowUsd).toBe('10.01');
  });

  it('counts the fee toward the amount being evaluated', () => {
    const plan = makePlan({
      outflow: [delta(USDC, '50', '50')],
      fee: {
        totalUsd: '1',
        paidIn: 'usdc',
        breakdown: { networkUsd: '0.5', paymasterUsd: '0.5', serviceUsd: '0' },
      },
    });

    // $50 is exactly at the threshold, but $50 + $1 fee is not.
    expect(evaluate(PERMISSIVE, plan).outcome).toBe('require_confirmation');
  });
});

describe('hard denials', () => {
  it('denies a sanctioned address outright, never merely asking', () => {
    const plan = makePlan({
      warnings: [warning({ code: 'address_flagged', severity: 'danger', message: 'Sanctioned.' })],
    });

    const decision = evaluate(PERMISSIVE, plan);

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons.map((r) => r.code)).toContain('address_flagged');
  });

  it('denies an action type the user has switched off', () => {
    const plan = makePlan({ intentType: 'swap' });

    const decision = evaluate({ ...PERMISSIVE, allowedActions: ['transfer'] }, plan);

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons.map((r) => r.code)).toContain('action_not_allowed');
  });

  it('denies a token outside the allowlist', () => {
    const plan = makePlan({ outflow: [delta(SKETCHY_TOKEN, '10', '10')] });

    const decision = evaluate({ ...PERMISSIVE, tokenAllowlist: ['USDC'] }, plan);

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons.map((r) => r.code)).toContain('token_not_allowed');
  });

  it('allows any token when the allowlist is null', () => {
    const plan = makePlan({ outflow: [delta(SKETCHY_TOKEN, '10', '10')] });

    expect(evaluate({ ...PERMISSIVE, tokenAllowlist: null }, plan).outcome).toBe('auto_execute');
  });

  it('denies above the per-transaction cap rather than asking', () => {
    const plan = makePlan({ outflow: [delta(USDC, '600', '600')] });

    const decision = evaluate(PERMISSIVE, plan);

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons.map((r) => r.code)).toContain('over_per_tx_cap');
  });

  it('reports every denial reason at once, not just the first', () => {
    const plan = makePlan({
      intentType: 'swap',
      outflow: [delta(SKETCHY_TOKEN, '900', '900')],
    });

    const codes = evaluate(PERMISSIVE, plan).reasons.map((r) => r.code);

    expect(codes).toContain('action_not_allowed');
    expect(codes).toContain('token_not_allowed');
    expect(codes).toContain('over_per_tx_cap');
  });
});

describe('the daily cap', () => {
  it('denies when prior spend plus this plan crosses the cap', () => {
    const decision = evaluate({ ...PERMISSIVE, dailyCapUsd: '100' }, makePlan(), '95');

    expect(decision.outcome).toBe('deny');
    expect(decision.reasons.map((r) => r.code)).toContain('over_daily_cap');
    expect(decision.projectedDailySpendUsd).toBe('105.01');
  });

  it('allows spend that lands exactly on the cap', () => {
    // $89.99 already spent + $10 + $0.01 fee = exactly $100.
    const decision = evaluate({ ...PERMISSIVE, dailyCapUsd: '100' }, makePlan(), '89.99');

    expect(decision.outcome).toBe('auto_execute');
    expect(decision.projectedDailySpendUsd).toBe('100');
  });

  /**
   * The salami-slice attack: many transfers each individually under every
   * per-transaction limit. Only the rolling daily total catches this, which is
   * precisely why the daily cap is not redundant with the per-tx cap.
   */
  it('stops a sequence of individually-small transfers once they accumulate', () => {
    const policy = { ...PERMISSIVE, dailyCapUsd: '100', autoExecuteThresholdUsd: '50' };

    let spent = 0;
    let approvals = 0;

    for (let i = 0; i < 50; i++) {
      const decision = evaluate(policy, makePlan(), spent.toFixed(2));
      if (decision.outcome !== 'auto_execute') break;
      approvals++;
      spent += 10.01;
    }

    expect(approvals).toBe(9); // 9 × $10.01 = $90.09; the 10th would cross $100.
    expect(spent).toBeCloseTo(90.09, 2);
  });
});

describe('recipients', () => {
  /**
   * The single most important behaviour here. A prompt-injected instruction to
   * send to an attacker's address is defeated by this rule even when the
   * attacker keeps the amount tiny to slip under every cap.
   */
  it('always requires confirmation for an unknown recipient, however small', () => {
    const plan = makePlan({
      outflow: [delta(USDC, '0.01', '0.01')],
      recipient: recipient({ known: false, display: '0x9999…9999' }),
    });

    const decision = evaluate(PERMISSIVE, plan);

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('recipient_not_allowlisted');
  });

  it('auto-executes to a known recipient at the same amount', () => {
    const plan = makePlan({ outflow: [delta(USDC, '0.01', '0.01')] });

    expect(evaluate(PERMISSIVE, plan).outcome).toBe('auto_execute');
  });
});

describe('degrading to human confirmation', () => {
  it('requires confirmation when agent autonomy is off', () => {
    const decision = evaluate({ ...PERMISSIVE, enabled: false });

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('agent_disabled');
  });

  it('requires confirmation above the auto-execute threshold', () => {
    const plan = makePlan({ outflow: [delta(USDC, '200', '200')] });

    const decision = evaluate(PERMISSIVE, plan);

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('over_auto_threshold');
  });

  it('never treats an unpriced asset as worth zero', () => {
    const plan = makePlan({ outflow: [delta(USDC, '10', null)] });

    const decision = evaluate(PERMISSIVE, plan);

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('unpriced_asset');
    expect(decision.outflowUsd).toBeNull();
  });

  it('requires confirmation on any danger-severity warning', () => {
    const plan = makePlan({
      warnings: [warning({ code: 'high_price_impact', severity: 'danger', message: 'Bad rate.' })],
    });

    const decision = evaluate(PERMISSIVE, plan);

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('dangerous_warning');
  });

  it('ignores info and warn severities on their own', () => {
    const plan = makePlan({ warnings: [warning({ severity: 'warn' }), warning({ severity: 'info' })] });

    expect(evaluate(PERMISSIVE, plan).outcome).toBe('auto_execute');
  });

  it('requires confirmation once the quote has expired', () => {
    const stale = new Date('2026-09-08T12:05:00.000Z');

    const decision = evaluatePolicy({
      policy: PERMISSIVE,
      plan: makePlan(),
      spentTodayUsd: '0',
      now: stale,
    });

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('plan_expired');
  });
});

describe('shipped defaults', () => {
  it('never auto-executes for a brand new user', () => {
    const decision = evaluate(DEFAULT_POLICY);

    expect(decision.outcome).toBe('require_confirmation');
    expect(decision.reasons.map((r) => r.code)).toContain('agent_disabled');
  });

  it('has an empty recipient allowlist, so every first send is supervised', () => {
    expect(DEFAULT_POLICY.recipientAllowlist).toEqual([]);
    expect(DEFAULT_POLICY.enabled).toBe(false);
  });
});
