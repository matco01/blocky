import { CHAIN } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { canPayForGeneralAction, selectGasStrategy, type GasContext } from '../src';

/**
 * The no-gas-token case is the default state of a real user, and the easiest
 * thing to break by accident because dev wallets usually have ETH lying
 * around. Every test here holds no native token unless it says otherwise.
 */
const arc: GasContext = {
  chainId: CHAIN.arcTestnet,
  networkFeeUsd: '0.005',
  usdcBalanceUsd: '50',
  nativeBalanceUsd: null,
};

const strategy = (overrides: Partial<GasContext> = {}) => selectGasStrategy({ ...arc, ...overrides });

describe('Arc — gas paid natively in USDC', () => {
  it('lets a USDC-only wallet transact', () => {
    const result = strategy();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('usdc');
      expect(result.plan.totalUsd).toBe('0.005');
    }
  });

  it('charges exactly the network fee — no surcharge, nobody in between', () => {
    const result = strategy({ networkFeeUsd: '1' });

    expect(result.ok && result.plan.totalUsd).toBe('1');
  });

  it('succeeds with a balance that exactly covers the fee', () => {
    expect(strategy({ networkFeeUsd: '0.005', usdcBalanceUsd: '0.005' }).ok).toBe(true);
  });

  it('fails when USDC cannot cover the fee — there is nothing else to pay with', () => {
    expect(strategy({ networkFeeUsd: '0.01', usdcBalanceUsd: '0.009' }).ok).toBe(false);
  });

  /**
   * On Arc the native balance *is* the USDC balance. A native figure must not
   * open a second route the USDC check already ruled out, or a broke wallet
   * looks able to pay.
   */
  it('does not fall through to a native route on Arc', () => {
    expect(strategy({ usdcBalanceUsd: '0', nativeBalanceUsd: '100' }).ok).toBe(false);
  });
});

describe('any other chain — its own gas token, or nothing', () => {
  const base = { chainId: CHAIN.baseSepolia } as const;

  it('pays in the gas token when the user holds enough of it there', () => {
    const result = strategy({ ...base, networkFeeUsd: '0.02', nativeBalanceUsd: '0.50' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.mode).toBe('native');
      expect(result.plan.totalUsd).toBe('0.02');
    }
  });

  /** Blocky never pays anyone's fees, and no paymaster turns USDC into gas. */
  it('does not use USDC to pay gas off Arc, however much of it there is', () => {
    expect(strategy({ ...base, usdcBalanceUsd: '5000', nativeBalanceUsd: null }).ok).toBe(false);
  });

  it('refuses a gas balance that exists but cannot cover the fee', () => {
    expect(strategy({ ...base, networkFeeUsd: '0.02', nativeBalanceUsd: '0.019' }).ok).toBe(false);
  });

  it('treats a gas balance it cannot value as not enough', () => {
    expect(strategy({ ...base, nativeBalanceUsd: null }).ok).toBe(false);
  });

  it('says which token is needed, and where', () => {
    const result = strategy({ chainId: CHAIN.polygon });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('no_gas_route');
      expect(result.message).toContain('POL');
      expect(result.message).toContain('Polygon');
    }
  });

  it('never produces a free plan', () => {
    for (const chainId of [CHAIN.arcTestnet, CHAIN.baseSepolia, CHAIN.polygon]) {
      const result = strategy({ chainId, nativeBalanceUsd: '100' });
      if (result.ok) expect(result.plan.totalUsd).not.toBe('0');
    }
  });
});

describe('acting on a destination chain', () => {
  it('says yes on Arc for a user holding only USDC', () => {
    expect(canPayForGeneralAction(arc)).toBe(true);
  });

  it('says no on Base for a user holding only USDC — plenty of money, no way to move it', () => {
    expect(canPayForGeneralAction({ ...arc, chainId: CHAIN.base, usdcBalanceUsd: '5000' })).toBe(false);
  });

  it('says yes once the user holds enough gas token there', () => {
    expect(canPayForGeneralAction({ ...arc, chainId: CHAIN.base, nativeBalanceUsd: '1' })).toBe(true);
  });
});
