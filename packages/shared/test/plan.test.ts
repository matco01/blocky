import { describe, expect, it } from 'vitest';
import { transactionsOf } from '../src';

describe('transactionsOf', () => {
  const call = (value: string, id: string) => ({ value, id });

  it('batches calls that carry no value into one transaction', () => {
    expect(transactionsOf([call('0', 'approve'), call('0', 'deposit')]).map((g) => g.map((c) => c.id))).toEqual([
      ['approve', 'deposit'],
    ]);
  });

  it('sends a value-carrying call on its own, keeping the order', () => {
    const groups = transactionsOf([call('0', 'approve'), call('0', 'deposit'), call('1000', 'gas')]);

    expect(groups.map((g) => g.map((c) => c.id))).toEqual([['approve', 'deposit'], ['gas']]);
  });

  it('never merges two value-carrying calls', () => {
    expect(transactionsOf([call('1', 'a'), call('2', 'b')]).map((g) => g.map((c) => c.id))).toEqual([['a'], ['b']]);
  });
});
