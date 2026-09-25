import { ARC_PUBLIC_RPC, DEFAULT_CHAIN, IS_TESTNET, getChain } from '@blocky/wallet-core';
import type { Chain } from 'viem';
import { arc, arcTestnet } from 'viem/chains';

/**
 * The chain this build signs on: Arc, on whichever network
 * `EXPO_PUBLIC_NETWORK` names (testnet unless it says exactly `mainnet`).
 *
 * viem's mainnet Arc definition ships without an RPC endpoint, so Arc's own
 * public one is filled in. Every signing path — Privy's EIP-7702
 * authorization, the smart account, the bundler — uses this one object, so
 * they cannot end up on different networks.
 */
export const homeChain: Chain = IS_TESTNET
  ? arcTestnet
  : {
      ...arc,
      rpcUrls: { default: { http: [ARC_PUBLIC_RPC] } },
      blockExplorers: { default: { name: 'Arc Explorer', url: getChain(DEFAULT_CHAIN).explorerUrl } },
    };

/** The home chain's name as users see it — "Arc", or "Arc Testnet". */
export const homeChainName = getChain(DEFAULT_CHAIN).name;
