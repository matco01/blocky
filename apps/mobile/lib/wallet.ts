import type { Address, PreparedCall } from '@blocky/shared';
import { useEmbeddedEthereumWallet } from '@privy-io/expo';
import { useCallback } from 'react';
import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  parseAbi,
  type Hex,
} from 'viem';
import { homeChain, homeChainName } from './chain';

/**
 * The user's wallet: their Privy embedded wallet, sending ordinary
 * transactions on Arc.
 *
 * No smart account, no bundler, no paymaster. On Arc the gas token *is* USDC,
 * so a plain transaction pays its own fee out of the balance being spent — the
 * planner has already reserved room for it. That makes the plainest path also
 * the cheapest: a USDC send costs ~75k gas here, against ~125k for the same
 * send as an ERC-4337 user operation, and nothing sits between the phone and
 * the chain.
 *
 * Several calls (approve, then move) go out as one transaction through Arc's
 * Multicall3From, which runs each call *as the wallet* — through Arc's CallFrom
 * precompile — and reverts all of them if any one fails. Verified on the live
 * chain before this was written: the approval inside the batch is the
 * wallet's own, a batch with a failing call reverts whole, and the burn it
 * performs is attributed to the wallet.
 */

/** Arc's Multicall3From, at the same address on mainnet and testnet. */
const MULTICALL_FROM: Address = '0x522faf9a91c41c443c66765030741e4aace147d0';
const MULTICALL_FROM_ABI = parseAbi([
  'function aggregate((address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)',
]);

const publicClient = createPublicClient({ chain: homeChain, transport: http() });

export type SendStage = 'preparing' | 'submitting' | 'confirming';

/**
 * The transaction was (or may have been) submitted, and its outcome is unknown.
 *
 * Distinct from an ordinary error on purpose: the screen must not offer a
 * retry for this one, because the first attempt may still land.
 */
export class SubmittedButUnconfirmedError extends Error {
  constructor(readonly txHash: Hex | null = null) {
    super('Submitted, but not confirmed yet.');
    this.name = 'SubmittedButUnconfirmedError';
  }
}

function isAmbiguousNetworkError(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return Boolean(error.walk((cause) => cause instanceof TimeoutError || cause instanceof HttpRequestError));
}

/** One call goes as itself; several go as one all-or-nothing Multicall3From batch. */
function toTransaction(calls: readonly PreparedCall[]): { to: Address; data: Hex; value: bigint } {
  if (calls.length === 1) {
    const [call] = calls as [PreparedCall];
    return { to: call.to, data: call.data as Hex, value: BigInt(call.value) };
  }

  // Multicall3From is not payable; the planner never attaches value to a batched call.
  if (calls.some((call) => BigInt(call.value) !== 0n)) {
    throw new Error('A batched call carried a value. Nothing was sent.');
  }

  return {
    to: MULTICALL_FROM,
    data: encodeFunctionData({
      abi: MULTICALL_FROM_ABI,
      functionName: 'aggregate',
      args: [calls.map((call) => ({ target: call.to, callData: call.data as Hex }))],
    }),
    value: 0n,
  };
}

export function useWallet() {
  const { wallets } = useEmbeddedEthereumWallet();
  const wallet = wallets[0];

  /**
   * Sign and send a planned set of calls as one transaction. Resolves to the
   * transaction hash once it is included — on Arc, that is final.
   */
  const sendCalls = useCallback(
    async (calls: readonly PreparedCall[], onStage?: (stage: SendStage) => void): Promise<Hex> => {
      if (!wallet) throw new Error('Your wallet is still being set up.');

      // The planner only builds calls on the home chain. Refuse anything else
      // outright rather than signing a call against a chain this client isn't
      // pointed at — including the same app talking to a server that is on the
      // other network.
      if (calls.length === 0 || calls.some((call) => call.chainId !== homeChain.id)) {
        throw new Error(`That transaction is not for ${homeChainName}. Nothing was signed.`);
      }

      onStage?.('preparing');

      const address = wallet.address.toLowerCase() as Address;
      const transaction = toTransaction(calls);
      const walletClient = createWalletClient({
        account: address,
        chain: homeChain,
        transport: custom(await wallet.getProvider()),
      });

      onStage?.('submitting');

      let hash: Hex;
      try {
        hash = await walletClient.sendTransaction({ ...transaction, chain: homeChain });
      } catch (error) {
        // A rejection means nothing was submitted. A timeout or dropped
        // connection means we cannot know — it may have gone through.
        if (isAmbiguousNetworkError(error)) throw new SubmittedButUnconfirmedError();
        throw error;
      }

      onStage?.('confirming');

      /*
       * From here the transaction is out. Any failure to *observe* the result
       * is not a failure of the send, and must never be reported as one: the
       * user would tap "try again" and pay twice.
       */
      let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
      try {
        receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      } catch {
        throw new SubmittedButUnconfirmedError(hash);
      }

      if (receipt.status !== 'success') {
        // Included, but it reverted: the money did not move.
        throw new Error('The transaction failed on-chain. Nothing was sent.');
      }

      return hash;
    },
    [wallet],
  );

  return {
    address: (wallet?.address.toLowerCase() ?? null) as Address | null,
    ready: Boolean(wallet),
    sendCalls,
  };
}
