import { CHAIN, formatUsd, type Address, type ChainId } from '@blocky/shared';
import {
  TransactionReceiptNotFoundError,
  createPublicClient,
  http,
  type Chain,
  type PublicClient,
} from 'viem';
import {
  arbitrum,
  arbitrumSepolia,
  arc,
  arcTestnet,
  avalanche,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
  unichain,
} from 'viem/chains';
import { normalize } from 'viem/ens';
import { CHAINS } from './chains';
import { NETWORK, type Network } from './network';
import type { Receipt } from './receipts';

/**
 * viem's chain objects, by our chain id.
 *
 * Not decoration: a client built without one has no ENS universal resolver
 * address, and every ENS lookup fails with an error that reads like a network
 * problem. Only mainnet carries that resolver, which is why ENS resolution is
 * pinned to chain 1 below regardless of where the transfer will settle.
 */
const VIEM_CHAINS: Record<ChainId, Chain> = {
  [CHAIN.ethereum]: mainnet,
  [CHAIN.optimism]: optimism,
  [CHAIN.unichain]: unichain,
  [CHAIN.polygon]: polygon,
  [CHAIN.base]: base,
  [CHAIN.arbitrum]: arbitrum,
  [CHAIN.avalanche]: avalanche,
  [CHAIN.arc]: arc,
  [CHAIN.arcTestnet]: arcTestnet,
  [CHAIN.baseSepolia]: baseSepolia,
  [CHAIN.arbitrumSepolia]: arbitrumSepolia,
};

/**
 * Chain reads.
 *
 * The server's only door to an RPC endpoint, and the only file in the shared
 * packages that imports viem. (The app's signing path has its own client — it
 * has to run where the key is.) Everything here is read-only: no signing, no
 * broadcasting, nothing that changes state.
 *
 * These are primitives, not policy. Deciding what to do with a balance belongs
 * to the planner; this just fetches it.
 */

/** Minimal ERC-20 surface. Hand-written because we need four functions, not a standard. */
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

export interface RpcConfig {
  /** RPC endpoint per chain. A chain with no entry simply cannot be read. */
  urls: Partial<Record<ChainId, string>>;
}

export interface TokenMetadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export interface ChainReader {
  /** ERC-20 balance in base units. */
  erc20Balance(chainId: ChainId, token: Address, owner: Address): Promise<bigint>;
  /**
   * Native balance in the chain's smallest unit. On Arc that is USDC at 18
   * decimals — the *same money* as the ERC-20 balance, so never add the two.
   */
  nativeBalance(chainId: ChainId, owner: Address): Promise<bigint>;
  /** Symbol, name and decimals, read from the contract itself. */
  tokenMetadata(chainId: ChainId, token: Address): Promise<TokenMetadata | null>;
  /** True when the address has bytecode — worth flagging before a plain transfer. */
  isContract(chainId: ChainId, address: Address): Promise<boolean>;
  /** Current gas price in native units (18-decimal USDC on Arc), for fee estimation. */
  gasPrice(chainId: ChainId): Promise<bigint>;
  /** Whether we have an endpoint configured for a chain at all. */
  supports(chainId: ChainId): boolean;

  /**
   * A mined transaction's outcome and logs. Null when the chain has not seen
   * the hash (yet) — not an error, since a just-submitted transaction may not
   * be visible to this node for a moment.
   */
  transactionReceipt(chainId: ChainId, hash: `0x${string}`): Promise<Receipt | null>;

  /**
   * ENS name to address. Null when it does not resolve.
   *
   * Always answered on Ethereum mainnet, whatever chain the transfer will
   * settle on — ENS is a naming layer, not a per-chain registry. Needs an
   * Ethereum endpoint configured; without one this returns null rather than
   * throwing, so a missing optional endpoint degrades to a clarifying question.
   */
  resolveEns(name: string): Promise<Address | null>;

  /** Address to primary ENS name, for display. Null when there is no record. */
  lookupEns(address: Address): Promise<string | null>;
}

/**
 * Normalise an address the way `AddressSchema` does.
 *
 * viem hands back EIP-55 checksummed addresses; the rest of the product stores
 * and compares them lowercased, so that allowlist membership is never
 * checksum-sensitive. An address that skips this reads as a different address
 * to `isKnownRecipient` — which means a recipient the user explicitly
 * allowlisted is treated as a stranger, forever.
 */
function lowercase(address: string): Address {
  return address.toLowerCase() as Address;
}

export function createChainReader(config: RpcConfig): ChainReader {
  // One client per chain, created on first use and kept. Rebuilding a transport
  // per call throws away connection reuse for no reason.
  const clients = new Map<ChainId, PublicClient>();

  function clientFor(chainId: ChainId): PublicClient {
    const existing = clients.get(chainId);
    if (existing) return existing;

    const url = config.urls[chainId];

    if (!url) {
      throw new Error(
        `No RPC endpoint configured for ${CHAINS[chainId].name}. Set it before reading this chain.`,
      );
    }

    const client = createPublicClient({
      chain: VIEM_CHAINS[chainId],
      transport: http(url),
    }) as PublicClient;
    clients.set(chainId, client);

    return client;
  }

  return {
    supports(chainId) {
      return Boolean(config.urls[chainId]);
    },

    async erc20Balance(chainId, token, owner) {
      return clientFor(chainId).readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [owner],
      });
    },

    async nativeBalance(chainId, owner) {
      return clientFor(chainId).getBalance({ address: owner });
    },

    async tokenMetadata(chainId, token) {
      const client = clientFor(chainId);
      const contract = { address: token, abi: ERC20_ABI } as const;

      try {
        const [symbol, name, decimals] = await Promise.all([
          client.readContract({ ...contract, functionName: 'symbol' }),
          client.readContract({ ...contract, functionName: 'name' }),
          client.readContract({ ...contract, functionName: 'decimals' }),
        ]);

        return { address: token, symbol, name, decimals };
      } catch {
        // Not an ERC-20, or not deployed. Null means "ask the user", never a guess.
        return null;
      }
    },

    async isContract(chainId, address) {
      const code = await clientFor(chainId).getCode({ address });

      return code !== undefined && code !== '0x';
    },

    async gasPrice(chainId) {
      return clientFor(chainId).getGasPrice();
    },

    async transactionReceipt(chainId, hash) {
      try {
        const receipt = await clientFor(chainId).getTransactionReceipt({ hash });

        return {
          status: receipt.status,
          logs: receipt.logs.map((log) => ({
            address: lowercase(log.address),
            topics: log.topics,
            data: log.data,
          })),
        };
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },

    async resolveEns(name) {
      if (!config.urls[CHAIN.ethereum]) return null;

      try {
        // UTS-46 normalisation. Skipping it means a name with an uppercase
        // letter or a confusable character resolves to nothing, or worse, to
        // something else.
        const address = await clientFor(CHAIN.ethereum).getEnsAddress({ name: normalize(name) });

        return address ? lowercase(address) : null;
      } catch {
        return null;
      }
    },

    async lookupEns(address) {
      if (!config.urls[CHAIN.ethereum]) return null;

      try {
        return await clientFor(CHAIN.ethereum).getEnsName({ address });
      } catch {
        return null;
      }
    },
  };
}

/** Every endpoint the server can be given. Each network reads only its own. */
export interface RpcEnv {
  // Testnet
  ARC_TESTNET_RPC_URL?: string | undefined;
  BASE_SEPOLIA_RPC_URL?: string | undefined;
  ARBITRUM_SEPOLIA_RPC_URL?: string | undefined;
  // Mainnet
  ARC_RPC_URL?: string | undefined;
  BASE_RPC_URL?: string | undefined;
  ARBITRUM_RPC_URL?: string | undefined;
  OPTIMISM_RPC_URL?: string | undefined;
  POLYGON_RPC_URL?: string | undefined;
  UNICHAIN_RPC_URL?: string | undefined;
  AVALANCHE_RPC_URL?: string | undefined;
  /** Both networks: ENS always resolves on Ethereum mainnet. */
  ETHEREUM_RPC_URL?: string | undefined;
}

/**
 * Read RPC endpoints out of the environment, for this build's network only.
 *
 * Testnet reads exactly what is set. Mainnet fills any chain left unset with
 * its public endpoint — viem's default, or Arc's own — so holdings and the
 * destination-gas check work out of the box. Public endpoints are
 * rate-limited: fine to start on, and each can be overridden with a provider
 * URL as traffic grows. An endpoint that exists is a chain the planner will
 * quote against, so nothing from the other network is ever wired in.
 */
export function rpcConfigFromEnv(env: RpcEnv, network: Network = NETWORK): RpcConfig {
  const urls: Partial<Record<ChainId, string>> = {};

  if (network === 'testnet') {
    if (env.ARC_TESTNET_RPC_URL) urls[CHAIN.arcTestnet] = env.ARC_TESTNET_RPC_URL;
    if (env.BASE_SEPOLIA_RPC_URL) urls[CHAIN.baseSepolia] = env.BASE_SEPOLIA_RPC_URL;
    if (env.ARBITRUM_SEPOLIA_RPC_URL) urls[CHAIN.arbitrumSepolia] = env.ARBITRUM_SEPOLIA_RPC_URL;

    /*
     * Ethereum is configured for ENS lookups alone on testnet, not because we
     * transact there. Optional: without it, ENS names come back unresolved and
     * the agent asks for an address instead of guessing at one.
     */
    if (env.ETHEREUM_RPC_URL) urls[CHAIN.ethereum] = env.ETHEREUM_RPC_URL;

    return { urls };
  }

  const wire = (chainId: ChainId, configured: string | undefined) => {
    const url = configured ?? VIEM_CHAINS[chainId].rpcUrls.default.http[0];
    if (url) urls[chainId] = url;
  };

  wire(CHAIN.arc, env.ARC_RPC_URL ?? ARC_PUBLIC_RPC);
  wire(CHAIN.ethereum, env.ETHEREUM_RPC_URL);
  wire(CHAIN.base, env.BASE_RPC_URL);
  wire(CHAIN.arbitrum, env.ARBITRUM_RPC_URL);
  wire(CHAIN.optimism, env.OPTIMISM_RPC_URL);
  wire(CHAIN.polygon, env.POLYGON_RPC_URL);
  wire(CHAIN.unichain, env.UNICHAIN_RPC_URL);
  wire(CHAIN.avalanche, env.AVALANCHE_RPC_URL);

  return { urls };
}

/** Arc's own public endpoint. viem's Arc definition ships without one. */
export const ARC_PUBLIC_RPC = 'https://rpc.mainnet.arc.io';

/**
 * Spendable USDC in a wallet on one chain: base units, and the same amount as
 * a dollar string (USDC's 6 decimals are the dollar scale).
 *
 * The Home screen, the agent's `get_balance` and the planner all read this, and
 * they must never disagree — the agent would talk the user out of a send the
 * planner would build, or promise one it then refuses. One function keeps
 * them the same read.
 */
export async function readUsdcBalance(
  reader: ChainReader,
  chainId: ChainId,
  owner: Address,
): Promise<{ amount: bigint; usd: string }> {
  const amount = await reader.erc20Balance(chainId, CHAINS[chainId].usdc, owner);
  return { amount, usd: formatUsd(amount) };
}
