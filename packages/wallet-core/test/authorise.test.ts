import { CHAIN, DEFAULT_POLICY, type Address, type Policy } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import {
  authoriseCalls,
  decodeTransferAmount,
  deriveSessionPermissions,
  selectorOf,
  usdcAddress,
} from '../src';

/**
 * The server-side mirror of the on-chain validator.
 *
 * Every test here is a call the chain would reject. Refusing first is not
 * belt-and-braces — it is the difference between a clear explanation and a
 * revert the user paid gas for. The rule throughout: when we cannot tell
 * whether something is allowed, refuse.
 */

const USDC = usdcAddress(CHAIN.baseSepolia);
const SIGNER = '0x00000000000000000000000000000000000000a9' as Address;
const ALICE = '0x2222222222222222222222222222222222222222' as Address;

const policy: Policy = { ...DEFAULT_POLICY, enabled: true, dailyCapUsd: '250' };

function session(overrides: Partial<Policy> = {}) {
  return deriveSessionPermissions({
    policy: { ...policy, ...overrides },
    chainId: CHAIN.baseSepolia,
    signerAddress: SIGNER,
  });
}

/** An ERC-20 transfer of `amount` base units to `to`. */
function transferCall(to: Address, amount: bigint, over: Record<string, unknown> = {}) {
  return {
    chainId: CHAIN.baseSepolia,
    to: USDC,
    data: `0xa9059cbb${to.slice(2).padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`,
    value: '0',
    ...over,
  };
}

describe('the happy path', () => {
  it('authorises a USDC transfer inside the limit', () => {
    expect(authoriseCalls(session(), [transferCall(ALICE, 20_000_000n)]).ok).toBe(true);
  });

  it('authorises several transfers that sum to the limit exactly', () => {
    const result = authoriseCalls(session(), [
      transferCall(ALICE, 100_000_000n),
      transferCall(ALICE, 150_000_000n),
    ]);

    expect(result.ok).toBe(true);
  });
});

describe('spend limits are cumulative', () => {
  it('refuses a batch that breaches the cap in aggregate', () => {
    // Each of these passes on its own. Checking per-call would wave them through.
    const result = authoriseCalls(session(), [
      transferCall(ALICE, 200_000_000n),
      transferCall(ALICE, 200_000_000n),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('over_spend_limit');
  });

  it('refuses a single transfer over the daily cap', () => {
    const result = authoriseCalls(session(), [transferCall(ALICE, 999_000_000n)]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('over_spend_limit');
  });
});

describe('what the session may touch', () => {
  it('refuses a contract it was never granted', () => {
    const result = authoriseCalls(session(), [
      transferCall(ALICE, 1n, { to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('target_not_permitted');
  });

  it('refuses a different function on a contract it may call', () => {
    // `approve` on USDC. Granting transfer must not imply granting approve —
    // an approval is an open-ended claim on the balance.
    const result = authoriseCalls(session(), [
      transferCall(ALICE, 1n, {
        data: `0x095ea7b3${ALICE.slice(2).padStart(64, '0')}${'f'.repeat(64)}`,
      }),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('selector_not_permitted');
  });

  it('refuses to send native token at all', () => {
    const result = authoriseCalls(session(), [transferCall(ALICE, 1n, { value: '1000' })]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('native_value_not_permitted');
  });

  it('refuses a call on the wrong chain', () => {
    const result = authoriseCalls(session(), [
      transferCall(ALICE, 1n, { chainId: CHAIN.arbitrumSepolia }),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('wrong_chain');
  });

  it('grants nothing when the policy allows no actions', () => {
    const result = authoriseCalls(session({ allowedActions: [] }), [
      transferCall(ALICE, 1n),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('target_not_permitted');
  });
});

describe('calls we cannot measure', () => {
  it('refuses calldata it cannot decode an amount from', () => {
    // Right target, right selector, truncated arguments. We cannot check this
    // against a spend limit, so it does not get signed.
    const result = authoriseCalls(session(), [transferCall(ALICE, 1n, { data: '0xa9059cbb' })]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('undecodable_call');
  });
});

describe('expiry', () => {
  it('refuses everything once the session has lapsed', () => {
    const permissions = session();
    const after = new Date((permissions.validUntil + 1) * 1000);

    const result = authoriseCalls(permissions, [transferCall(ALICE, 1n)], after);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('session_expired');
  });
});

describe('decoding helpers', () => {
  it('reads the selector', () => {
    expect(selectorOf('0xa9059cbb0000')).toBe('0xa9059cbb');
    expect(selectorOf('0xa9')).toBeNull();
  });

  it('reads a transfer amount', () => {
    expect(decodeTransferAmount(transferCall(ALICE, 12_345n).data)).toBe(12_345n);
  });

  it('returns null for calldata of the wrong length', () => {
    expect(decodeTransferAmount('0xa9059cbb')).toBeNull();
  });

  it('returns null for a different function', () => {
    expect(decodeTransferAmount(`0x095ea7b3${'0'.repeat(128)}`)).toBeNull();
  });
});
