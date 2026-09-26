import { CHAIN, type Address, type ChainId } from '@blocky/shared';
import { IS_TESTNET } from './network';

/**
 * The chain registry.
 *
 * Scope is Circle Gateway's supported set and nothing else. A chain outside it
 * cannot participate in the unified USDC balance, which would put a bridging
 * step back in front of the user — the exact thing this product exists to
 * remove. Adding a chain here is a product decision, not a config change.
 *
 * ⚠️  Token addresses are load-bearing: a wrong one sends real money somewhere
 * unrecoverable. Every mainnet USDC address and Circle domain below was checked
 * against the live chains (`symbol()`/`decimals()` on each, and Circle's
 * Gateway `/info`) before mainnet, not only against the docs. Re-check any
 * you add the same way.
 */

export interface ChainConfig {
  id: ChainId;
  name: string;
  /** Short label for the rare places we must show a chain at all. */
  shortName: string;
  testnet: boolean;
  /**
   * The chain's native currency as the node reports it. On Arc this is USDC at
   * 18 decimals — see {@link nativeToUsdcUnits} before doing anything with it.
   */
  nativeCurrency: { symbol: string; decimals: number };
  /**
   * Canonical (native, not bridged) USDC, as an ERC-20 at 6 decimals. Null on
   * a chain with none (Robinhood Chain): money reaches it only as a swap.
   */
  usdc: Address | null;
  explorerUrl: string;
  /** Whether Circle Gateway supports a unified balance here. */
  gateway: boolean;
  /**
   * Circle's domain id for this chain — one number shared by Gateway and CCTP.
   * Null where we have not verified it: mainnet ids get checked before
   * mainnet, not guessed.
   */
  circleDomain: number | null;
  /**
   * True when gas is paid in USDC natively (Arc). A user holding only USDC can
   * transact here; anywhere else they need the chain's own gas token.
   */
  gasPaidInUsdc: boolean;
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
    circleDomain: 0,
    gasPaidInUsdc: false,
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
    circleDomain: 2,
    gasPaidInUsdc: false,
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
    circleDomain: 10,
    gasPaidInUsdc: false,
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
    circleDomain: 7,
    gasPaidInUsdc: false,
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
    circleDomain: 6,
    gasPaidInUsdc: false,
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
    circleDomain: 3,
    gasPaidInUsdc: false,
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
    circleDomain: 1,
    gasPaidInUsdc: false,
  },

  /**
   * HyperEVM — Hyperliquid's EVM chain; HYPE is its native token. Native
   * Circle USDC (checked on-chain: `symbol()` USDC, `decimals()` 6), Circle
   * domain 19, and Across's swap handler deployed.
   */
  [CHAIN.hyperevm]: {
    id: CHAIN.hyperevm,
    name: 'HyperEVM',
    shortName: 'HYPE',
    testnet: false,
    nativeCurrency: { symbol: 'HYPE', decimals: 18 },
    usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
    explorerUrl: 'https://hyperevmscan.io',
    gateway: true,
    circleDomain: 19,
    gasPaidInUsdc: false,
  },

  /**
   * Robinhood Chain — where tokenized US stocks live, as ordinary ERC-20s
   * (see `stocks.ts`). No USDC: its dollar is USDG, so money arrives here only
   * as a swap into a stock. Checked live: chain id 4663, gas in ETH.
   */
  [CHAIN.robinhood]: {
    id: CHAIN.robinhood,
    name: 'Robinhood Chain',
    shortName: 'RH',
    testnet: false,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: null,
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    gateway: false,
    circleDomain: null,
    gasPaidInUsdc: false,
  },

  /**
   * Arc — the home chain on mainnet.
   *
   * Verified against the live network: chain id 5042, USDC at the same 0x3600…
   * address with `decimals()` 6, EntryPoint v0.7 and Kernel v3.3's 7702
   * delegate deployed, Pimlico's bundler serving it, and CCTP v2 at Circle's
   * standard addresses. Addresses from https://docs.arc.io/arc/references/contract-addresses
   */
  [CHAIN.arc]: {
    id: CHAIN.arc,
    name: 'Arc',
    shortName: 'ARC',
    testnet: false,
    nativeCurrency: { symbol: 'USDC', decimals: 18 },
    usdc: '0x3600000000000000000000000000000000000000',
    explorerUrl: 'https://explorer.arc.io',
    gateway: true,
    circleDomain: 26,
    gasPaidInUsdc: true,
  },

  /* ---- Testnets ---------------------------------------------------------- */

  /**
   * Arc testnet — the home chain.
   *
   * Verified against the live network, not only the docs: chain id 5042002,
   * USDC `decimals()` returns 6, EntryPoint v0.7 and v0.8 are deployed, EIP-7702
   * authorizations are charged the spec's 25,000 gas, and Pimlico's bundler
   * serves it. Addresses from https://docs.arc.io/arc/references/contract-addresses
   */
  [CHAIN.arcTestnet]: {
    id: CHAIN.arcTestnet,
    name: 'Arc Testnet',
    shortName: 'ARC',
    testnet: true,
    nativeCurrency: { symbol: 'USDC', decimals: 18 },
    usdc: '0x3600000000000000000000000000000000000000',
    explorerUrl: 'https://testnet.arcscan.app',
    gateway: true,
    circleDomain: 26,
    gasPaidInUsdc: true,
  },
  [CHAIN.baseSepolia]: {
    id: CHAIN.baseSepolia,
    name: 'Base Sepolia',
    shortName: 'BASE',
    testnet: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    explorerUrl: 'https://sepolia.basescan.org',
    gateway: true,
    circleDomain: 6,
    gasPaidInUsdc: false,
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
    circleDomain: 3,
    gasPaidInUsdc: false,
  },
} as const satisfies Record<ChainId, ChainConfig>;

/** The home chain: Arc, on whichever network this build runs. Everything defaults here. */
export const DEFAULT_CHAIN: ChainId = IS_TESTNET ? CHAIN.arcTestnet : CHAIN.arc;

/**
 * The chains on this build's network. Test money and real money never meet:
 * nothing lists, reads or moves money on a chain from the other network.
 */
export function chainsOnNetwork(): ChainConfig[] {
  return Object.values(CHAINS).filter((chain) => chain.testnet === IS_TESTNET);
}

export function getChain(id: ChainId): ChainConfig {
  return CHAINS[id];
}

/** A chain's USDC. Throws on a chain with none — ask `getChain(id).usdc` where that is possible. */
export function usdcAddress(id: ChainId): Address {
  const usdc = CHAINS[id].usdc;
  if (!usdc) throw new Error(`${CHAINS[id].name} has no USDC.`);
  return usdc;
}

/**
 * ERC-4337 EntryPoint v0.7, at the same address on every chain that has it.
 *
 * Worth naming here because on Arc it shows up as a *counterparty*: gas is
 * native USDC, so every user operation transfers its prefund to this address
 * and the explorer reports that as an ordinary USDC transfer. Anything reading
 * transfers as user activity has to know this one is the fee.
 */
export const ENTRY_POINT_V07: Address = '0x0000000071727de22e5e9d8baf0edac6f37da032';

/* -------------------------------------------------------------------------- */
/*  Arc's two decimal scales                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Arc exposes one USDC balance through two interfaces: native (18 decimals —
 * `eth_getBalance`, `msg.value`, gas prices, fee estimates) and the ERC-20 at
 * 0x3600… (6 decimals — `balanceOf`, `transfer`). They are the same money.
 *
 * Reusing a raw integer across the two shifts the amount by 10^12. That is not
 * a rounding error, it is a trillion times too much or too little, so these two
 * functions are the only place in the codebase that crosses scales. Never sum a
 * native balance with an ERC-20 balance: that double-counts.
 */
const ARC_SCALE = 10n ** 12n;

/**
 * Native 18-decimal USDC to 6-decimal USDC units.
 *
 * Rounds *up*: this is used for fees, and understating a fee is how a
 * transaction that looked affordable fails at execution.
 */
export function nativeToUsdcUnits(native: bigint): bigint {
  if (native < 0n) throw new Error('Negative native amount');
  return (native + ARC_SCALE - 1n) / ARC_SCALE;
}

/** 6-decimal USDC units to native 18-decimal USDC. Exact. */
export function usdcUnitsToNative(units: bigint): bigint {
  if (units < 0n) throw new Error('Negative USDC amount');
  return units * ARC_SCALE;
}
