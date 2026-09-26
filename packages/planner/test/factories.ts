import { CHAIN, type Address, type ResolvedRecipient, type ResolvedToken } from '@blocky/shared';
import { CHAINS } from '@blocky/wallet-core';
import type { PlannerContext } from '../src/context';

export const ALICE = '0x2222222222222222222222222222222222222222' as Address;

export const USDC_ARC: ResolvedToken = {
  chainId: CHAIN.arcTestnet,
  address: CHAINS[CHAIN.arcTestnet].usdc,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUrl: null,
  verified: true,
};

export function tokenOn(chainId: keyof typeof CHAINS): ResolvedToken {
  return { ...USDC_ARC, chainId: CHAINS[chainId].id, address: CHAINS[chainId].usdc! };
}

export const ME = '0x1111111111111111111111111111111111111111' as Address;

export const SELF: ResolvedRecipient = {
  address: ME,
  display: 'your own wallet',
  ensName: null,
  contactLabel: null,
  known: false,
  isContract: false,
};

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
    resolveToken: async () => USDC_ARC,
    resolveRecipient: async (ref) => (ref.kind === 'self' ? SELF : KNOWN_RECIPIENT),
    priceOf: async () => '1',
    // 1,000 USDC.
    balanceOf: async () => 1_000_000_000n,
    usdcBalanceUsd: async () => '1000',
    nativeBalanceUsd: async () => null,
    bridgeFees: async () => ({ forwardFee: 54_565n, protocolFeeCentiBps: 0n }),
    acrossQuote: async () => null,
    acrossSwapQuote: async () => null,
    gasZipQuote: async () => null,
    acrossNativeSwapQuote: async () => null,
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

export function bridgeIntent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'bridge' as const,
    token: { kind: 'symbol' as const, symbol: 'USDC' },
    amount: { kind: 'usd' as const, value: '20' },
    toChainId: CHAIN.baseSepolia,
    rationale: 'Move $20 to Base Sepolia as asked.',
    ...overrides,
  };
}
