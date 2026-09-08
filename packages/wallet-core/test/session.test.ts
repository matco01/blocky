import { CHAIN, DEFAULT_POLICY, parseUnits, type Policy } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { deriveSessionPermissions, isSessionExpired, SESSION_TTL_SECONDS, usdcAddress } from '../src';

const AGENT_KEY = '0xa9e17000000000000000000000000000000a9e17' as const;
const NOW = new Date('2026-09-08T12:00:00.000Z');

const derive = (policy: Policy = { ...DEFAULT_POLICY, enabled: true }) =>
  deriveSessionPermissions({
    policy,
    chainId: CHAIN.baseSepolia,
    signerAddress: AGENT_KEY,
    now: NOW,
  });

describe('permission scope', () => {
  it('grants only ERC-20 transfer on the USDC contract', () => {
    const { calls } = derive();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(usdcAddress(CHAIN.baseSepolia));
    expect(calls[0]?.selectors).toEqual(['0xa9059cbb']);
  });

  /**
   * A blanket permission would make every other control decorative, so assert
   * the absence of one rather than trusting it stays absent.
   */
  it('never grants a wildcard target or selector', () => {
    for (const call of derive().calls) {
      expect(call.target).not.toBe('0x0000000000000000000000000000000000000000');
      expect(call.selectors).not.toContain('0x00000000');
      expect(call.selectors.length).toBeGreaterThan(0);
    }
  });

  it('grants nothing at all when no actions are allowed', () => {
    const { calls, spendLimits } = derive({ ...DEFAULT_POLICY, allowedActions: [] });

    expect(calls).toEqual([]);
    expect(spendLimits).toEqual([]);
  });

  it('refuses to mint a swap session until swaps are properly scoped', () => {
    expect(() => derive({ ...DEFAULT_POLICY, allowedActions: ['swap'] })).toThrow(/M5/);
  });
});

describe('spend limits', () => {
  /**
   * The on-chain cap bounds *total* loss under a compromised server, so it
   * tracks the daily cap rather than the per-transaction one.
   */
  it('encodes the daily cap, not the per-transaction cap', () => {
    const { spendLimits } = derive({
      ...DEFAULT_POLICY,
      perTxCapUsd: '100',
      dailyCapUsd: '250',
    });

    expect(spendLimits[0]?.limit).toBe(parseUnits('250', 6));
  });

  it('never exceeds the policy the user actually set', () => {
    for (const dailyCap of ['0', '1', '250', '10000']) {
      const { spendLimits } = derive({ ...DEFAULT_POLICY, dailyCapUsd: dailyCap });
      expect(spendLimits[0]?.limit).toBeLessThanOrEqual(parseUnits(dailyCap, 6));
    }
  });
});

describe('expiry', () => {
  it('lasts 24 hours', () => {
    expect(derive().validUntil).toBe(Math.floor(NOW.getTime() / 1000) + SESSION_TTL_SECONDS);
  });

  it('is expired a second after it lapses', () => {
    const permissions = derive();
    const justAfter = new Date((permissions.validUntil + 1) * 1000);
    const justBefore = new Date((permissions.validUntil - 1) * 1000);

    expect(isSessionExpired(permissions, justAfter)).toBe(true);
    expect(isSessionExpired(permissions, justBefore)).toBe(false);
  });
});
