import { CHAIN, type Plan } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { categorise, crossedBudgetLines, monthInsights, previousMonth } from '../src/insights';

/** Just enough of a plan to categorise and count. */
function plan(over: Partial<Plan> & { outUsd?: string; inToken?: { chainId: number; address: string; symbol: string } }): Plan {
  const usdc = { chainId: CHAIN.arcTestnet, address: '0x3600000000000000000000000000000000000000', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUrl: null, verified: true };
  return {
    id: crypto.randomUUID(),
    intentType: 'transfer',
    summary: 'test',
    modelRationale: '',
    outflow: [{ token: usdc, amount: '0', displayAmount: over.outUsd ?? '10', usdValue: over.outUsd ?? '10' }],
    inflow: over.inToken ? [{ token: { ...usdc, ...over.inToken }, amount: '1', displayAmount: '1', usdValue: over.outUsd ?? '10' }] : [],
    recipient: { address: '0x1111111111111111111111111111111111111111', display: '@sam', ensName: null, contactLabel: null, known: true, isContract: false },
    fee: { totalUsd: '0.01', paidIn: 'usdc', breakdown: { networkUsd: '0.01', paymasterUsd: '0', serviceUsd: '0' } },
    warnings: [],
    calls: [],
    simulation: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...over,
  } as Plan;
}

describe('categories', () => {
  it('reads a send to someone as people, and a buy as investing', () => {
    expect(categorise(plan({}))).toBe('people');
    expect(
      categorise(plan({ intentType: 'bridge', recipient: null, inToken: { chainId: CHAIN.base, address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', symbol: 'DEGEN' } })),
    ).toBe('investing');
  });
});

describe('a month', () => {
  it('adds up spending by person, fees apart, and compares with last month', () => {
    const now = '2026-09-10T12:00:00.000Z';
    const insights = monthInsights(
      '2026-09',
      [
        { plan: plan({ outUsd: '10' }), at: now },
        { plan: plan({ outUsd: '5' }), at: now },
        { plan: plan({ outUsd: '40' }), at: '2026-08-02T00:00:00.000Z' },
      ],
      [{ from: '@mallory', usd: '3', at: now }],
    );

    expect(insights).toMatchObject({
      spentUsd: '15',
      feesUsd: '0.02',
      receivedUsd: '3',
      topPeople: [{ name: '@sam', usd: '15' }],
      lastMonthSpentUsd: '40',
      count: 2,
    });
    expect(previousMonth('2026-01')).toBe('2025-12');
  });
});

describe('budget lines', () => {
  it('says each line once, at the move that crosses it', () => {
    expect(crossedBudgetLines(100n, 70n, 85n)).toEqual([80]);
    expect(crossedBudgetLines(100n, 70n, 120n)).toEqual([80, 100]);
    expect(crossedBudgetLines(100n, 85n, 90n)).toEqual([]);
  });
});
