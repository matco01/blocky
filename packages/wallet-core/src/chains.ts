import { CHAIN, type Address, type ChainId } from '@blocky/shared';

/**
 * The chain registry.
 *
 * Scope is Circle Gateway's supported set and nothing else. A chain outside it
 * cannot participate in the unified USDC balance, which would put a bridging
 * step back in front of the user — the exact thing this product exists to
 * remove. Adding a chain here is a product decision, not a config change.
 *
 * ⚠️  Token addresses are load-bearing: a wrong one sends real money somewhere
 * unrecoverable. Every mainnet address below must be re-verified against
 * Circle's published list (https://developers.circle.com/stablecoins/usdc-contract-addresses)
 * before mainnet launch. v1 runs on Base Sepolia only.
 */

export interface ChainConfig {
  id: ChainId;
  name: string;
  /** Short label for the rare places we must show a chain at all. */
  shortName: string;
  testnet: boolean;
  nativeCurrency: { symbol: string; decimals: number };
  /** Canonical (native, not bridged) USDC. */
  usdc: Address;
  explorerUrl: string;
  /** Whether Circle Gateway supports a unified balance here. */
  gateway: boolean;
  /** Whether Circle Paymaster can take gas in USDC here. */
  paymaster: boolean;
}

export const CHAINS = {
  [CHAIN.ethereum]: {
    id: CHAIN.ethereum,
    name: 'Ethereum',
    shortName: 'ETH',
    testnet: false,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    explorerUrl: 'https://etherscan.io',
    gateway: true,
    paymaster: false,
  },
  [CHAIN.optimism]: {
    id: CHAIN.optimism,
    name: 'OP Mainnet',
    shortName: 'OP',
    testnet: false,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    explorerUrl: 'https://optimistic.etherscan.io',
    gateway: true,
    paymaster: false,
  },
  [CHAIN.unichain]: {
    id: CHAIN.unichain,
    name: 'Unichain',
    shortName: 'UNI',
    testnet: false,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0x078d782b760474a361dda0af3839290b0ef57ad6',
    explorerUrl: 'https://uniscan.xyz',
    gateway: true,
    paymaster: false,
  },
  [CHAIN.polygon]: {
    id: CHAIN.polygon,
    name: 'Polygon',
    shortName: 'POL',
    testnet: false,
    nativeCurrency: { symbol: 'POL', decimals: 18 },
    usdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    explorerUrl: 'https://polygonscan.com',
    gateway: true,
    paymaster: false,
  },
  [CHAIN.base]: {
    id: CHAIN.base,
    name: 'Base',
    shortName: 'BASE',
    testnet: false,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    explorerUrl: 'https://basescan.org',
    gateway: true,
    paymaster: true,
  },
  [CHAIN.arbitrum]: {
    id: CHAIN.arbitrum,
    name: 'Arbitrum One',
    shortName: 'ARB',
    testnet: false,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    explorerUrl: 'https://arbiscan.io',
    gateway: true,
    paymaster: true,
  },
  [CHAIN.avalanche]: {
    id: CHAIN.avalanche,
    name: 'Avalanche',
    shortName: 'AVAX',
    testnet: false,
    nativeCurrency: { symbol: 'AVAX', decimals: 18 },
    usdc: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    explorerUrl: 'https://snowtrace.io',
    gateway: true,
    paymaster: false,
  },

  /* ---- Testnets. v1 lives here. ---------------------------------------- */

  [CHAIN.baseSepolia]: {
    id: CHAIN.baseSepolia,
    name: 'Base Sepolia',
    shortName: 'BASE',
    testnet: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    explorerUrl: 'https://sepolia.basescan.org',
    gateway: true,
    paymaster: true,
  },
  [CHAIN.arbitrumSepolia]: {
    id: CHAIN.arbitrumSepolia,
    name: 'Arbitrum Sepolia',
    shortName: 'ARB',
    testnet: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
    explorerUrl: 'https://sepolia.arbiscan.io',
    gateway: true,
    paymaster: true,
  },
} as const satisfies Record<ChainId, ChainConfig>;

/** The chain everything defaults to until we go to mainnet. */
export const DEFAULT_CHAIN: ChainId = CHAIN.baseSepolia;

export function getChain(id: ChainId): ChainConfig {
  return CHAINS[id];
}

export function usdcAddress(id: ChainId): Address {
  return CHAINS[id].usdc;
}

export function txUrl(id: ChainId, hash: string): string {
  return `${CHAINS[id].explorerUrl}/tx/${hash}`;
}

export function addressUrl(id: ChainId, address: Address): string {
  return `${CHAINS[id].explorerUrl}/address/${address}`;
}

export const GATEWAY_CHAINS = Object.values(CHAINS).filter((c) => c.gateway);
export const PAYMASTER_CHAINS = Object.values(CHAINS).filter((c) => c.paymaster);
