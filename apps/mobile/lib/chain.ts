import { ARC_PUBLIC_RPC, DEFAULT_CHAIN, IS_TESTNET, chainsOnNetwork, getChain } from '@blocky/wallet-core';
import type { Chain } from 'viem';
import {
  arbitrum,
  arbitrumSepolia,
  arc,
  arcTestnet,
  avalanche,
  base,
  baseSepolia,
  hyperEvm,
  mainnet,
  optimism,
  polygon,
  unichain,
} from 'viem/chains';

/**
 * The chains this build signs on, as viem needs them.
 *
 * Arc is home: most money lives there and every send starts there. But money
 * moved or swapped out to another chain has to be able to come back, so the
 * wallet can sign on every chain of this build's network — `EXPO_PUBLIC_NETWORK`
 * picks which (testnet unless it says exactly `mainnet`), and the other
 * network's chains are never listed.
 *
 * viem's mainnet Arc definition ships without an RPC endpoint, so Arc's own
 * public one is filled in.
 */
export const homeChain: Chain = IS_TESTNET
  ? arcTestnet
  : {
      ...arc,
      rpcUrls: { default: { http: [ARC_PUBLIC_RPC] } },
      blockExplorers: { default: { name: 'Arc Explorer', url: getChain(DEFAULT_CHAIN).explorerUrl } },
    };

const VIEM_CHAINS: Record<number, Chain> = {
  [homeChain.id]: homeChain,
  [mainnet.id]: mainnet,
  [optimism.id]: optimism,
  [unichain.id]: unichain,
  [polygon.id]: polygon,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [avalanche.id]: avalanche,
  [hyperEvm.id]: hyperEvm,
  [baseSepolia.id]: baseSepolia,
  [arbitrumSepolia.id]: arbitrumSepolia,
};

/** Every chain on this network the wallet may sign on — home first, so it is the embedded wallet's default. */
export const signingChains: [Chain, ...Chain[]] = [
  homeChain,
  ...chainsOnNetwork()
    .filter((chain) => chain.id !== homeChain.id)
    .map((chain) => VIEM_CHAINS[chain.id])
    .filter((chain): chain is Chain => Boolean(chain)),
];

/** The viem chain for an id, only if it is one this build signs on. */
export function signingChain(chainId: number): Chain | null {
  return signingChains.find((chain) => chain.id === chainId) ?? null;
}

/** The home chain's name as users see it — "Arc", or "Arc Testnet". */
export const homeChainName = getChain(DEFAULT_CHAIN).name;
