import { describe, expect, it } from 'vitest';
import { CHAIN, parseIntent } from '../src';

/**
 * These tests treat model output as hostile input, because that is what it is:
 * partly the model's own reasoning, partly attacker-controlled strings that
 * reached its context through token names, ENS records and transfer memos.
 */

const validTransfer = {
  type: 'transfer',
  token: { kind: 'symbol', symbol: 'USDC' },
  amount: { kind: 'usd', value: '20' },
  recipient: { kind: 'ens', name: 'alice.eth' },
  rationale: 'User asked to send $20 to Alice.',
};

describe('well-formed intents', () => {
  it('accepts a transfer', () => {
    const result = parseIntent(validTransfer);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.intent.type).toBe('transfer');
  });

  it('accepts a swap and defaults amountRefersTo', () => {
    const result = parseIntent({
      type: 'swap',
      from: { kind: 'symbol', symbol: 'USDC' },
      to: { kind: 'symbol', symbol: 'ETH' },
      amount: { kind: 'usd', value: '50' },
      rationale: 'Swapping fifty dollars into ETH.',
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.intent.type === 'swap') {
      expect(result.intent.amountRefersTo).toBe('from');
    }
  });

  it('lowercases addresses so allowlist checks are not checksum-sensitive', () => {
    const result = parseIntent({
      ...validTransfer,
      recipient: { kind: 'address', address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.intent.type === 'transfer') {
      expect(result.intent.recipient).toEqual({
        kind: 'address',
        address: '0xabcdef0123456789abcdef0123456789abcdef01',
      });
    }
  });
});

describe('malformed output is rejected, never repaired', () => {
  it('rejects an unknown intent type', () => {
    expect(parseIntent({ ...validTransfer, type: 'drain_wallet' }).ok).toBe(false);
  });

  it('rejects a truncated address instead of padding it', () => {
    const result = parseIntent({
      ...validTransfer,
      recipient: { kind: 'address', address: '0x1111' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/address/i);
  });

  it('rejects a negative amount', () => {
    expect(parseIntent({ ...validTransfer, amount: { kind: 'usd', value: '-20' } }).ok).toBe(false);
  });

  it('rejects a numeric amount, which would invite float handling downstream', () => {
    expect(parseIntent({ ...validTransfer, amount: { kind: 'usd', value: 20 } }).ok).toBe(false);
  });

  it('rejects scientific notation', () => {
    expect(parseIntent({ ...validTransfer, amount: { kind: 'usd', value: '2e1' } }).ok).toBe(false);
  });

  it('rejects an unsupported chain', () => {
    const result = parseIntent({ ...validTransfer, chainId: 999999 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/chain/i);
  });

  it('accepts a supported chain', () => {
    expect(parseIntent({ ...validTransfer, chainId: CHAIN.baseSepolia }).ok).toBe(true);
  });

  it('rejects slippage beyond the permitted band', () => {
    const swap = {
      type: 'swap',
      from: { kind: 'symbol', symbol: 'USDC' },
      to: { kind: 'symbol', symbol: 'ETH' },
      amount: { kind: 'usd', value: '50' },
      rationale: 'Swap.',
    };

    // 90% slippage would let a sandwich attack take almost everything.
    expect(parseIntent({ ...swap, maxSlippageBps: 9000 }).ok).toBe(false);
    expect(parseIntent({ ...swap, maxSlippageBps: 100 }).ok).toBe(true);
  });

  it('reports every validation issue, so the model can fix them in one retry', () => {
    const result = parseIntent({
      type: 'transfer',
      token: { kind: 'symbol', symbol: '' },
      amount: { kind: 'usd', value: 'twenty dollars' },
      recipient: { kind: 'address', address: 'not-an-address' },
      rationale: '',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(1);
  });
});

describe('the escape hatches that must not exist', () => {
  /**
   * The whole safety model rests on the model being unable to express a raw
   * transaction. If a passthrough field is ever added, these fail — which is
   * the point.
   */
  it('silently drops any calldata the model tries to smuggle through', () => {
    const result = parseIntent({
      ...validTransfer,
      data: '0xdeadbeef',
      calldata: '0xdeadbeef',
      to: '0xattacker0000000000000000000000000000dead',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent).not.toHaveProperty('data');
      expect(result.intent).not.toHaveProperty('calldata');
      expect(result.intent).not.toHaveProperty('to');
    }
  });

  it('offers no free-text recipient shape', () => {
    expect(parseIntent({ ...validTransfer, recipient: { kind: 'raw', value: 'anywhere' } }).ok).toBe(
      false,
    );
    expect(parseIntent({ ...validTransfer, recipient: 'alice.eth' }).ok).toBe(false);
  });

  it('rejects non-object input outright', () => {
    for (const bad of [null, undefined, 'transfer', 42, []]) {
      expect(parseIntent(bad).ok, `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});
