import { describe, expect, it } from 'vitest';
import { TRANSFER_TOPIC, containsTransfer, type Receipt } from '../src';

const USDC = '0x3600000000000000000000000000000000000000' as const;
const SYSTEM_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';
const ALICE = '0xa10e88ef09a737ee0c99794a9a1a943c6d0e31ee' as const;
const SAM = '0xec3fdbc250cec0338d96a34ef988238323411b9d' as const;

const topic = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;

function erc20Log(from: string, to: string, amount: bigint, emitter: string = USDC) {
  return { address: emitter, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: word(amount) };
}

const expected = { token: USDC, from: ALICE, to: SAM, amount: 20_000_000n };

describe('matching a receipt to a plan', () => {
  it('accepts the exact planned transfer', () => {
    const receipt: Receipt = { status: 'success', logs: [erc20Log(ALICE, SAM, 20_000_000n)] };

    expect(containsTransfer(receipt, expected)).toBe(true);
  });

  it('is not fooled by checksum casing', () => {
    const receipt: Receipt = {
      status: 'success',
      logs: [erc20Log(ALICE.toUpperCase().replace('0X', '0x'), SAM, 20_000_000n, USDC)],
    };

    expect(containsTransfer(receipt, expected)).toBe(true);
  });

  it('finds it among unrelated logs, as in a user operation', () => {
    const receipt: Receipt = {
      status: 'success',
      logs: [
        { address: '0x4337084d9e255ff0702461cf8895ce9e3b5ff108', topics: ['0x1234'], data: '0x' },
        erc20Log(ALICE, SAM, 20_000_000n),
      ],
    };

    expect(containsTransfer(receipt, expected)).toBe(true);
  });

  it('rejects a reverted transaction even if the log shape matches', () => {
    const receipt: Receipt = { status: 'reverted', logs: [erc20Log(ALICE, SAM, 20_000_000n)] };

    expect(containsTransfer(receipt, expected)).toBe(false);
  });

  it('rejects a different amount, recipient, or sender', () => {
    const variants = [
      erc20Log(ALICE, SAM, 20_000_001n),
      erc20Log(ALICE, ALICE, 20_000_000n),
      erc20Log(SAM, SAM, 20_000_000n),
    ];

    for (const log of variants) {
      expect(containsTransfer({ status: 'success', logs: [log] }, expected)).toBe(false);
    }
  });

  /**
   * The Arc trap, using the shape observed on the live testnet: a native USDC
   * send emits an identical Transfer event from a system address at 18
   * decimals. It is not the planned ERC-20 call, and its amount is on a
   * different scale entirely.
   */
  it('does not accept Arc’s native system-emitter Transfer as the ERC-20 call', () => {
    const native: Receipt = {
      status: 'success',
      logs: [erc20Log(ALICE, SAM, 20_000_000n * 10n ** 12n, SYSTEM_EMITTER)],
    };

    expect(containsTransfer(native, expected)).toBe(false);

    // Nor when the raw number happens to equal the 6-decimal amount.
    const lookalike: Receipt = {
      status: 'success',
      logs: [erc20Log(ALICE, SAM, 20_000_000n, SYSTEM_EMITTER)],
    };

    expect(containsTransfer(lookalike, expected)).toBe(false);
  });

  it('rejects malformed logs instead of guessing', () => {
    const receipt: Receipt = {
      status: 'success',
      logs: [{ address: USDC, topics: [TRANSFER_TOPIC, topic(ALICE)], data: '0xzz' }],
    };

    expect(containsTransfer(receipt, expected)).toBe(false);
  });
});
