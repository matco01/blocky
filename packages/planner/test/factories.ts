import { CHAIN, type Address, type ResolvedRecipient, type ResolvedToken } from '@blocky/shared';
import { CHAINS } from '@blocky/wallet-core';
import type { PlannerContext } from '../src/context';

export const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
export const ALICE = '0x2222222222222222222222222222222222222222' as Address;

export const USDC_BASE_SEPOLIA: ResolvedToken = {
  chainId: CHAIN.baseSepolia,
  address: CHAINS[CHAIN.baseSepolia].usdc,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUrl: null,
  verified: true,
};

export function tokenOn(chainId: keyof typeof CHAINS): ResolvedToken {
  return { ...USDC_BASE_SEPOLIA, chainId: CHAINS[chainId].id, address: CHAINS[chainId].usdc };
}

export const KNOWN_RECIPIENT: ResolvedRecipient = {
  address: ALICE,
  display: 'alice.eth',
  ensName: 'alice.eth',
  contactLabel: null,
  known: true,
  isContract: false,
};

/**
 * A context where everything works and nothing is surprising.
 *
 * Every test starts from this and overrides the single thing it is about, so a
 * test's diff from the baseline is exactly the condition under test.
 */
export function fakeContext(overrides: Partial<PlannerContext> = {}): PlannerContext {
  return {
    accountAddress: async () => ACCOUNT,
    resolveToken: async () => USDC_BASE_SEPOLIA,
    resolveRecipient: async () => KNOWN_RECIPIENT,
    priceOf: async () => '1',
    // 1,000 USDC.
    balanceOf: async () => 1_000_000_000n,
    usdcBalanceUsd: async () => '1000',
    hasNativeBalance: async () => false,
    // Past the onboarding sponsorship, so fees are real by default.
    lifetimeTxCount: async () => 99,
    estimateNetworkFeeUsd: async () => '0.10',
    isAddressFlagged: async () => false,
    ...overrides,
  };
}

export function transferIntent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'transfer' as const,
    token: { kind: 'symbol' as const, symbol: 'USDC' },
    amount: { kind: 'usd' as const, value: '20' },
    recipient: { kind: 'address' as const, address: ALICE },
    rationale: 'Send $20 of USDC as asked.',
    ...overrides,
  };
}
