import type { Address, PreparedCall } from '@blocky/shared';
import { decodeFunctionData, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { MULTICALL_FROM, isExactTransaction, transactionFor } from '../src';

const ME = '0x578c01d4e7e70fbc61d12b72cf52009914b91d2d' as Address;
const call = (to: string, data: string, value = '0'): PreparedCall => ({
  chainId: 5042,
  to: to as Address,
  data: data as `0x${string}`,
  value,
  description: '',
});

const approve = call('0x3600000000000000000000000000000000000000', '0x095ea7b3aa');
const deposit = call('0x9b4a302a548c7e313c2b74c461db7b84d3074a84', '0x7b939232bb');

describe('transactionFor', () => {
  it('sends a single call as itself', () => {
    expect(transactionFor([call('0x9e22ebec84c7e4c4bd6d4ae7ff6f4d436d6d8390', '0xc9630cb0', '2000')])).toEqual({
      to: '0x9e22ebec84c7e4c4bd6d4ae7ff6f4d436d6d8390',
      data: '0xc9630cb0',
      value: 2000n,
    });
  });

  it('batches several calls through Multicall3From, in order', () => {
    const tx = transactionFor([approve, deposit]);
    const { args } = decodeFunctionData({
      abi: parseAbi(['function aggregate((address target, bytes callData)[] calls)']),
      data: tx.data,
    });

    expect(tx.to).toBe(MULTICALL_FROM);
    expect(tx.value).toBe(0n);
    expect(args[0].map((c) => [c.target.toLowerCase(), c.callData])).toEqual([
      [approve.to, approve.data],
      [deposit.to, deposit.data],
    ]);
  });

  it('refuses to batch a call that carries value — the batch contract cannot forward it', () => {
    expect(() => transactionFor([approve, call(deposit.to, deposit.data, '1')])).toThrow(/value/);
  });
});

describe('isExactTransaction', () => {
  const tx = transactionFor([approve, deposit]);
  const sent = { from: ME, to: tx.to, value: tx.value, input: tx.data };
  const expected = { from: ME, calls: [approve, deposit] };

  it('accepts the exact transaction the calls make, from the wallet', () => {
    expect(isExactTransaction(sent, 'success', expected)).toBe(true);
  });

  it.each([
    ['from someone else', { from: '0x3333333333333333333333333333333333333333' }],
    ['to another contract', { to: '0x3333333333333333333333333333333333333333' }],
    ['with different calldata', { input: transactionFor([approve]).data }],
    ['carrying value', { value: 1n }],
  ])('rejects one %s', (_, over) => {
    expect(isExactTransaction({ ...sent, ...over }, 'success', expected)).toBe(false);
  });

  it('rejects a reverted one, or one the node did not return', () => {
    expect(isExactTransaction(sent, 'reverted', expected)).toBe(false);
    expect(isExactTransaction(undefined, 'success', expected)).toBe(false);
  });
});
