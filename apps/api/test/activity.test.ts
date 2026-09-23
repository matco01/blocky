import { CHAIN } from '@blocky/shared';
import { ENTRY_POINT_V07, cctpContracts } from '@blocky/wallet-core';
import type { Address } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { mergeActivity, type ExplorerTransfer } from '../src/activity';
import type { Execution } from '../src/store';

/**
 * The activity feed is the user's record of where their money went. Two things
 * it must never do: invent a counterparty they never dealt with, or hide a
 * transfer that really happened.
 *
 * On Arc those pull against each other, because gas *is* a USDC transfer.
 */

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const ALICE = '0x2222222222222222222222222222222222222222' as Address;

function transfer(over: Partial<ExplorerTransfer> = {}): ExplorerTransfer {
  return {
    txHash: '0xaaa',
    logIndex: 0,
    from: WALLET,
    to: ALICE,
    value: 2_000_000n,
    timestamp: '2026-09-21T12:00:00.000Z',
    ...over,
  };
}

describe('gas is not activity', () => {
  it('leaves the EntryPoint prefund out of the feed', () => {
    // One user operation: the real transfer, and the gas that paid for it.
    const items = mergeActivity(
      WALLET,
      [],
      [
        transfer({ logIndex: 0, to: ALICE, value: 2_000_000n }),
        transfer({ logIndex: 1, to: ENTRY_POINT_V07, value: 4_000n }),
      ],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.counterparty).toBe(ALICE);
    expect(items[0]?.amount).toBe('2');
  });

  it('does not list a sub-cent gas payment as a $0.00 send', () => {
    // What the user actually saw: "Sent to 0x0000…a032  −$0.00".
    const items = mergeActivity(
      WALLET,
      [],
      [transfer({ to: ENTRY_POINT_V07, value: 3_500n })],
    );

    expect(items).toHaveLength(0);
  });

  it('still records money arriving from the EntryPoint', () => {
    // Filtering is one-directional: a refund is real money coming back, and
    // hiding an inflow is a worse failure than showing an odd counterparty.
    const items = mergeActivity(
      WALLET,
      [],
      [transfer({ from: ENTRY_POINT_V07, to: WALLET, value: 1_000n })],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.direction).toBe('received');
  });
});

describe('ordinary sends are untouched', () => {
  it('keeps a plain transfer out', () => {
    const items = mergeActivity(WALLET, [], [transfer()]);

    expect(items).toHaveLength(1);
    expect(items[0]?.direction).toBe('sent');
  });

  it('keeps money received', () => {
    const items = mergeActivity(
      WALLET,
      [],
      [transfer({ from: ALICE, to: WALLET, value: 20_000_000n })],
    );

    expect(items[0]?.direction).toBe('received');
    expect(items[0]?.amount).toBe('20');
  });

  it('carries our own summary onto the matching on-chain transfer', () => {
    const execution: Execution = {
      id: 'e1',
      txHash: '0xaaa',
      counterparty: ALICE,
      amount: '2',
      status: 'success',
      summary: 'Send 2 USDC to alice.eth. $0.01 fee.',
      createdAt: new Date('2026-09-21T12:00:00.000Z'),
    } as Execution;

    const items = mergeActivity(WALLET, [execution], [transfer()]);

    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toContain('alice.eth');
  });
});

/**
 * Money moved to the user's own wallet on another chain leaves through
 * Circle's CCTP minter. "Sent to 0xb43d…f192" would read as paying a stranger.
 */
describe('moves between chains', () => {
  const MINTER = cctpContracts(CHAIN.arcTestnet)!.tokenMinter;

  it('says the money moved chains, rather than naming the contract it passed through', () => {
    const [item] = mergeActivity(WALLET, [], [transfer({ to: MINTER })]);

    expect(item?.title).toBe('Moved to another chain');
    expect(item?.direction).toBe('sent');
  });

  it('leaves an ordinary send to be worded by the app', () => {
    expect(mergeActivity(WALLET, [], [transfer()])[0]?.title).toBeNull();
  });
});
