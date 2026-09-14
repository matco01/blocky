import { CHAIN } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { canPayForGeneralAction, selectGasStrategy, type GasContext } from '../src';

/**
 * The zero-ETH case is the default state of a real user, and the easiest thing
 * to break by accident because dev wallets usually have ETH lying around. Every
 * test here holds no native token unless it says otherwise.
 */
const arc: GasContext = {
  chainId: CHAIN.arcTestnet,
  networkFeeUsd: '0.005',
  usdcBalanceUsd: '50',
  hasNativeBalance: false,
};

const strategy = (overrides: Partial<GasContext> = {}) => selectGasStrategy({ ...arc, ...overrides });

describe('tier 1 — Arc, gas paid natively in USDC', () => {
  it('lets a USDC-only wallet transact with no paymaster', () => {
    const result = strategy();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('usdc');
      expect(result.plan.totalUsd).toBe('0.005');
    }
  });

  it('charges no surcharge, because there is no paymaster to pay', () => {
    const result = strategy({ networkFeeUsd: '1' });

    expect(result.ok && result.plan.paymasterUsd).toBe('0');
    expect(result.ok && result.plan.totalUsd).toBe('1');
  });

  it('succeeds with a balance that exactly covers the fee', () => {
    expect(strategy({ networkFeeUsd: '0.005', usdcBalanceUsd: '0.005' }).ok).toBe(true);
  });

  it('fails when USDC cannot cover the fee — there is nothing else to pay with', () => {
    const result = strategy({ networkFeeUsd: '0.01', usdcBalanceUsd: '0.009' });

    expect(result.ok).toBe(false);
  });

  /**
   * On Arc the native balance *is* the USDC balance. "Has native token" must
   * not open a second route that the USDC check already ruled out, or a broke
   * wallet looks able to pay.
   */
  it('does not fall through to a native fallback on Arc', () => {
    const result = strategy({ usdcBalanceUsd: '0', hasNativeBalance: true });

    expect(result.ok).toBe(false);
  });
});

describe('tier 2 — Circle Paymaster, gas in USDC with a surcharge', () => {
  const base = { chainId: CHAIN.baseSepolia } as const;

  it('folds the 10% surcharge into a single total', () => {
    const result = strategy({ ...base, networkFeeUsd: '1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('usdc');
      expect(result.plan.networkUsd).toBe('1');
      expect(result.plan.paymasterUsd).toBe('0.1');
      // The only number the UI is allowed to show.
      expect(result.plan.totalUsd).toBe('1.1');
    }
  });

  it('falls through when USDC cannot cover fee plus surcharge', () => {
    // $1.05 covers the $1 fee but not the $1.10 all-in cost.
    expect(strategy({ ...base, networkFeeUsd: '1', usdcBalanceUsd: '1.05' }).ok).toBe(false);
  });
});

describe('the corrections', () => {
  /**
   * An earlier version charged $0 for any USDC send on the belief that Gateway
   * settles it gas-free. It does not, and a $0 fee on a transaction that costs
   * gas is a plan that fails on-chain. No input may produce a free plan now.
   */
  it('never produces a sponsored, zero-fee plan', () => {
    for (const chainId of [CHAIN.arcTestnet, CHAIN.baseSepolia, CHAIN.polygon]) {
      const result = strategy({ chainId, hasNativeBalance: true });
      if (result.ok) {
        expect(result.plan.mode).not.toBe('sponsored');
        expect(result.plan.totalUsd).not.toBe('0');
      }
    }
  });
});

describe('tier 3 — native token fallback', () => {
  it('is used on a chain with neither USDC gas nor a paymaster', () => {
    const result = strategy({ chainId: CHAIN.polygon, hasNativeBalance: true });

    expect(result.ok && result.plan.mode).toBe('native');
  });

  it('fails with actionable advice when nothing can pay', () => {
    const result = strategy({ chainId: CHAIN.polygon, hasNativeBalance: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_gas_route');
      expect(result.message).toMatch(/add a little/i);
    }
  });
});

describe('acting on a destination chain', () => {
  it('says yes on Arc for a user holding only USDC', () => {
    expect(canPayForGeneralAction(arc)).toBe(true);
  });

  it('says yes on Base, where Circle Paymaster is deployed', () => {
    expect(canPayForGeneralAction({ ...arc, chainId: CHAIN.base, networkFeeUsd: '0.40' })).toBe(true);
  });

  it('says no on Polygon for a user holding only USDC', () => {
    // Plenty of money, no way to spend it.
    expect(
      canPayForGeneralAction({ ...arc, chainId: CHAIN.polygon, usdcBalanceUsd: '5000' }),
    ).toBe(false);
  });

  it('says yes on Polygon once the user holds native token', () => {
    expect(
      canPayForGeneralAction({ ...arc, chainId: CHAIN.polygon, hasNativeBalance: true }),
    ).toBe(true);
  });
});
