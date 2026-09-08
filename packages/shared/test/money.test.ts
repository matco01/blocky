import { describe, expect, it } from 'vitest';
import {
  displayUsd,
  formatUnits,
  formatUsd,
  parseUnits,
  parseUsd,
  sumUsd,
  tokenAmountForUsd,
  usdValueOf,
} from '../src';

describe('parseUnits', () => {
  it('converts human decimals to base units', () => {
    expect(parseUnits('10', 6)).toBe(10_000_000n);
    expect(parseUnits('0.05', 18)).toBe(50_000_000_000_000_000n);
    expect(parseUnits('0', 6)).toBe(0n);
  });

  it('handles zero-decimal tokens', () => {
    expect(parseUnits('42', 0)).toBe(42n);
  });

  /**
   * Silently truncating excess precision is how a wallet sends the wrong
   * amount. Loudly refusing is the only acceptable behaviour.
   */
  it('rejects more precision than the token supports', () => {
    expect(() => parseUnits('1.1234567', 6)).toThrow(/6/);
  });

  it('rejects anything that is not a plain non-negative decimal', () => {
    for (const bad of ['', '-1', '1e18', 'abc', '1.2.3', '01', ' 1', '1 ', 'Infinity', 'NaN']) {
      expect(() => parseUnits(bad, 6), `should reject ${JSON.stringify(bad)}`).toThrow();
    }
  });

  it('survives amounts far beyond Number.MAX_SAFE_INTEGER', () => {
    // ~1 billion ETH in wei — a float would have mangled this long ago.
    expect(parseUnits('1000000000.000000000000000001', 18)).toBe(
      1_000_000_000_000_000_000_000_000_001n,
    );
  });
});

describe('formatUnits', () => {
  it('round-trips with parseUnits', () => {
    for (const [value, decimals] of [
      ['10', 6],
      ['0.05', 18],
      ['1234.5678', 8],
      ['0', 6],
    ] as const) {
      expect(formatUnits(parseUnits(value, decimals), decimals)).toBe(value);
    }
  });

  it('trims trailing zeros but keeps significant ones', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits(1_000_000n, 6)).toBe('1');
    expect(formatUnits(1n, 6)).toBe('0.000001');
  });
});

describe('displayUsd', () => {
  it('always shows two decimal places', () => {
    expect(displayUsd('10')).toBe('$10.00');
    expect(displayUsd('0')).toBe('$0.00');
    expect(displayUsd('1.5')).toBe('$1.50');
  });

  it('groups thousands', () => {
    expect(displayUsd('1234567.89')).toBe('$1,234,567.89');
  });

  it('rounds half up to the cent', () => {
    expect(displayUsd('0.005')).toBe('$0.01');
    expect(displayUsd('0.004')).toBe('$0.00');
    expect(displayUsd('1.995')).toBe('$2.00');
  });
});

describe('conversion', () => {
  it('values a token holding in USD', () => {
    // 0.5 ETH at $3,000 = $1,500.
    expect(formatUsd(usdValueOf(parseUnits('0.5', 18), 18, '3000'))).toBe('1500');
  });

  it('converts a USD amount into token base units', () => {
    // $20 of USDC at $1 = 20 USDC.
    expect(tokenAmountForUsd('20', 6, '1')).toBe(20_000_000n);
    // $20 of ETH at $4,000 = 0.005 ETH.
    expect(formatUnits(tokenAmountForUsd('20', 18, '4000'), 18)).toBe('0.005');
  });

  it('refuses to convert against an unknown price rather than guessing', () => {
    expect(() => tokenAmountForUsd('20', 18, '0')).toThrow(/price/);
  });
});

describe('sumUsd', () => {
  it('adds without float drift', () => {
    // The canonical float failure: 0.1 + 0.2 !== 0.3.
    expect(sumUsd(['0.1', '0.2'])).toBe('0.3');
  });

  it('stays exact across many small values', () => {
    expect(sumUsd(Array.from({ length: 100 }, () => '0.01'))).toBe('1');
  });

  it('sums an empty list to zero', () => {
    expect(sumUsd([])).toBe('0');
  });

  it('parses USD at six decimal places', () => {
    expect(parseUsd('1.000001')).toBe(1_000_001n);
  });
});
