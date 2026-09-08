import { CHAIN } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_SPONSORED_TX_COUNT, selectGasStrategy, type GasContext } from '../src';

/**
 * The zero-ETH case is the default state of a real user, and the easiest thing
 * to break by accident because dev wallets usually have ETH lying around. Every
 * test here holds no native token unless it says otherwise.
 */
const base: GasContext = {
  chainId: CHAIN.baseSepolia,
  isGatewayNativeTransfer: false,
  lifetimeTxCount: 100, // past onboarding sponsorship
  networkFeeUsd: '0.10',
  usdcBalanceUsd: '50',
  hasNativeBalance: false,
};

const strategy = (overrides: Partial<GasContext> = {}) =>
  selectGasStrategy({ ...base, ...overrides });

describe('tier 1 — Gateway gas-free USDC', () => {
  it('costs the user nothing for a plain USDC send', () => {
    const result = strategy({ isGatewayNativeTransfer: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('sponsored');
      expect(result.plan.totalUsd).toBe('0');
    }
  });

  it('takes precedence over paymaster even for an established user', () => {
    const result = strategy({ isGatewayNativeTransfer: true, lifetimeTxCount: 10_000 });

    expect(result.ok && result.plan.totalUsd).toBe('0');
  });
});

describe('tier 2 — onboarding sponsorship', () => {
  it('sponsors a brand-new account with literally zero of everything', () => {
    const result = strategy({
      lifetimeTxCount: 0,
      usdcBalanceUsd: '0',
      hasNativeBalance: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('sponsored');
      expect(result.plan.totalUsd).toBe('0');
    }
  });

  it('stops sponsoring once the allowance is used up', () => {
    const last = strategy({ lifetimeTxCount: ONBOARDING_SPONSORED_TX_COUNT - 1 });
    const next = strategy({ lifetimeTxCount: ONBOARDING_SPONSORED_TX_COUNT });

    expect(last.ok && last.plan.mode).toBe('sponsored');
    expect(next.ok && next.plan.mode).toBe('usdc');
  });
});

describe('tier 3 — Circle Paymaster, gas in USDC', () => {
  it('folds the 10% surcharge into a single total', () => {
    const result = strategy({ networkFeeUsd: '1' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('usdc');
      expect(result.plan.networkUsd).toBe('1');
      expect(result.plan.paymasterUsd).toBe('0.1');
      // The only number the UI is allowed to show.
      expect(result.plan.totalUsd).toBe('1.1');
    }
  });

  it('lets a user with no native token transact using USDC alone', () => {
    const result = strategy({ hasNativeBalance: false, usdcBalanceUsd: '5' });

    expect(result.ok && result.plan.mode).toBe('usdc');
  });

  it('falls through when USDC cannot cover fee plus surcharge', () => {
    // $1.05 covers the $1 fee but not the $1.10 all-in cost.
    const result = strategy({ networkFeeUsd: '1', usdcBalanceUsd: '1.05' });

    expect(result.ok).toBe(false);
  });

  it('is skipped on chains where Circle Paymaster is not deployed', () => {
    const result = strategy({ chainId: CHAIN.polygon, hasNativeBalance: true });

    expect(result.ok && result.plan.mode).toBe('native');
  });
});

describe('when there is no way to pay', () => {
  it('fails with actionable advice rather than a broadcast error', () => {
    const result = strategy({ usdcBalanceUsd: '0', hasNativeBalance: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_gas_route');
      expect(result.message).toMatch(/add a little/i);
    }
  });

  it('still sends a plain USDC transfer, since Gateway needs no gas', () => {
    const result = strategy({
      isGatewayNativeTransfer: true,
      usdcBalanceUsd: '0',
      hasNativeBalance: false,
    });

    expect(result.ok).toBe(true);
  });
});
