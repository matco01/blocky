import { CHAIN, parseUnits } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { CHAINS, DEFAULT_CHAIN, nativeToUsdcUnits, usdcUnitsToNative } from '../src';

/**
 * Arc exposes the same USDC at 18 decimals (native) and 6 decimals (ERC-20).
 * Mixing the two is a 10^12 error in either direction, so the conversion gets
 * its own tests rather than being trusted as arithmetic.
 */

describe('Arc is the home chain', () => {
  it('is the default', () => {
    expect(DEFAULT_CHAIN).toBe(CHAIN.arcTestnet);
  });

  it('pays gas in USDC', () => {
    const arc = CHAINS[CHAIN.arcTestnet];

    expect(arc.gasPaidInUsdc).toBe(true);
    expect(arc.nativeCurrency).toEqual({ symbol: 'USDC', decimals: 18 });
  });

  it('is the only chain that pays gas in USDC, on either network', () => {
    const usdcGas = Object.values(CHAINS).filter((chain) => chain.gasPaidInUsdc);

    expect(usdcGas.map((chain) => chain.id).sort()).toEqual([CHAIN.arc, CHAIN.arcTestnet].sort());
  });

  it('uses the same USDC contract on mainnet as on testnet', () => {
    expect(CHAINS[CHAIN.arc].usdc).toBe(CHAINS[CHAIN.arcTestnet].usdc);
    expect(CHAINS[CHAIN.arc].testnet).toBe(false);
    expect(CHAINS[CHAIN.arc].circleDomain).toBe(26);
  });
});

describe('native (18) ↔ ERC-20 (6) USDC', () => {
  it('maps one whole USDC across scales', () => {
    const oneNative = 10n ** 18n;
    const oneErc20 = parseUnits('1', 6);

    expect(nativeToUsdcUnits(oneNative)).toBe(oneErc20);
    expect(usdcUnitsToNative(oneErc20)).toBe(oneNative);
  });

  it('round-trips ERC-20 units exactly', () => {
    for (const units of [0n, 1n, 1_234_567n, 10n ** 15n]) {
      expect(nativeToUsdcUnits(usdcUnitsToNative(units))).toBe(units);
    }
  });

  /**
   * Fees arrive in native units and often carry precision below one ERC-20
   * unit. Rounding them down understates the fee; rounding up never does.
   */
  it('rounds a sub-unit native fee up, never down', () => {
    expect(nativeToUsdcUnits(1n)).toBe(1n);
    expect(nativeToUsdcUnits(10n ** 12n + 1n)).toBe(2n);
  });

  it('converts a real Arc fee sensibly', () => {
    // Observed gas price on Arc testnet (~2.05e10 native per gas) × 250k gas.
    const feeNative = 20_478_300_267n * 250_000n;

    // About half a cent, expressed in 6-decimal USDC units.
    expect(nativeToUsdcUnits(feeNative)).toBe(5_120n);
  });

  it('refuses negative amounts rather than wrapping them', () => {
    expect(() => nativeToUsdcUnits(-1n)).toThrow();
    expect(() => usdcUnitsToNative(-1n)).toThrow();
  });
});
