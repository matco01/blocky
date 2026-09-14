import { describe, expect, it } from 'vitest';
import { assetDelta, resolveAmount } from '../src/amount';
import { encodeErc20Transfer } from '../src/calls';
import { ALICE, USDC_ARC } from './factories';

const token = USDC_ARC;
const BALANCE = 1_000_000_000n; // 1,000 USDC

const base = { token, unitPrice: '1' as string | null, balance: BALANCE };

describe('token-denominated amounts', () => {
  it('converts exactly', () => {
    expect(resolveAmount({ ...base, spec: { kind: 'token', value: '12.34' } })).toEqual({
      ok: true,
      amount: 12_340_000n,
    });
  });

  it('rejects more precision than the token holds rather than truncating', () => {
    // 7 decimals into a 6-decimal token. Silently dropping the last digit is
    // how someone sends the wrong amount.
    expect(resolveAmount({ ...base, spec: { kind: 'token', value: '1.1234567' } })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects zero', () => {
    expect(resolveAmount({ ...base, spec: { kind: 'token', value: '0' } })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects more than the balance', () => {
    expect(resolveAmount({ ...base, spec: { kind: 'token', value: '1001' } })).toEqual({
      ok: false,
      reason: 'insufficient',
    });
  });

  it('counts the reserved fee against a fixed amount, not just against max', () => {
    // Balance exactly equal to the amount, with a fee still to pay from it.
    expect(
      resolveAmount({ ...base, spec: { kind: 'token', value: '1000' }, reserve: 1n }),
    ).toEqual({ ok: false, reason: 'insufficient' });

    expect(
      resolveAmount({ ...base, spec: { kind: 'usd', value: '999.999999' }, reserve: 1n }),
    ).toEqual({ ok: true, amount: BALANCE - 1n });
  });

  it('allows spending the balance exactly', () => {
    expect(resolveAmount({ ...base, spec: { kind: 'token', value: '1000' } })).toEqual({
      ok: true,
      amount: BALANCE,
    });
  });
});

describe('USD-denominated amounts', () => {
  it('converts at the given price', () => {
    expect(
      resolveAmount({ ...base, unitPrice: '2', spec: { kind: 'usd', value: '50' } }),
    ).toEqual({ ok: true, amount: 25_000_000n });
  });

  it('refuses to convert without a price instead of assuming parity', () => {
    expect(
      resolveAmount({ ...base, unitPrice: null, spec: { kind: 'usd', value: '20' } }),
    ).toEqual({ ok: false, reason: 'unpriced' });
  });
});

describe('max', () => {
  it('is the whole balance when nothing is reserved', () => {
    expect(resolveAmount({ ...base, spec: { kind: 'max' } })).toEqual({
      ok: true,
      amount: BALANCE,
    });
  });

  it('leaves the reserve behind, so the fee can still be paid', () => {
    expect(resolveAmount({ ...base, spec: { kind: 'max' }, reserve: 1_100_000n })).toEqual({
      ok: true,
      amount: BALANCE - 1_100_000n,
    });
  });

  it('reports insufficient when the fee would consume the whole balance', () => {
    // "You cannot afford to move this" — never a zero-value transfer.
    expect(resolveAmount({ ...base, spec: { kind: 'max' }, reserve: BALANCE })).toEqual({
      ok: false,
      reason: 'insufficient',
    });
  });
});

describe('display values', () => {
  it('keeps base units authoritative and derives the rest', () => {
    const delta = assetDelta(token, 20_500_000n, '1');

    expect(delta.amount).toBe('20500000');
    expect(delta.displayAmount).toBe('20.5');
    expect(delta.usdValue).toBe('20.5');
  });

  it('has no USD value for an unpriced token', () => {
    expect(assetDelta(token, 1n, null).usdValue).toBeNull();
  });
});

describe('calldata', () => {
  it('encodes transfer(address,uint256) to the byte', () => {
    const data = encodeErc20Transfer(ALICE, 20_000_000n);

    expect(data).toBe(
      '0xa9059cbb' +
        '0000000000000000000000002222222222222222222222222222222222222222' +
        '0000000000000000000000000000000000000000000000000000000001312d00',
    );
    // 4-byte selector + two 32-byte words.
    expect(data).toHaveLength(2 + 8 + 64 + 64);
  });

  it('refuses a negative amount rather than wrapping it', () => {
    expect(() => encodeErc20Transfer(ALICE, -1n)).toThrow();
  });

  it('refuses a value beyond uint256', () => {
    expect(() => encodeErc20Transfer(ALICE, 1n << 256n)).toThrow();
  });
});
