import { describe, expect, it } from 'vitest';
import { transactionsOf } from '../src';

describe('transactionsOf', () => {
  const call = (value: string, id: string, chainId = 5042) => ({ value, id, chainId });
  const arcOnly = (chainId: number) => chainId === 5042;

  it('batches calls that carry no value into one transaction', () => {
    expect(transactionsOf([call('0', 'approve'), call('0', 'deposit')], arcOnly).map((g) => g.map((c) => c.id))).toEqual([
      ['approve', 'deposit'],
    ]);
  });

  it('sends a value-carrying call on its own, keeping the order', () => {
    const groups = transactionsOf([call('0', 'approve'), call('0', 'deposit'), call('1000', 'gas')], arcOnly);

    expect(groups.map((g) => g.map((c) => c.id))).toEqual([['approve', 'deposit'], ['gas']]);
  });

  it('never merges two value-carrying calls', () => {
    expect(transactionsOf([call('1', 'a'), call('2', 'b')], arcOnly).map((g) => g.map((c) => c.id))).toEqual([['a'], ['b']]);
  });

  it('sends each call alone on a chain with no batching contract', () => {
    const onArbitrum = [call('0', 'approve', 42161), call('0', 'deposit', 42161)];

    expect(transactionsOf(onArbitrum, arcOnly).map((g) => g.map((c) => c.id))).toEqual([['approve'], ['deposit']]);
  });
});
