import type { Address, PreparedCall } from '@blocky/shared';
import { useEmbeddedEthereumWallet, useSign7702Authorization } from '@privy-io/expo';
import { createKernelAccount, createKernelAccountClient } from '@zerodev/sdk';
import { KERNEL_7702_DELEGATION_ADDRESS, KERNEL_V3_3, getEntryPoint } from '@zerodev/sdk/constants';
import { useCallback } from 'react';
import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  http,
  type Client,
  type Hex,
} from 'viem';
import { arcTestnet } from 'viem/chains';
import { config } from './config';

/**
 * The user's smart account: their Privy embedded wallet, upgraded in place to a
 * ZeroDev Kernel v3.3 account with EIP-7702.
 *
 * Every piece of this path was verified against the live Arc testnet before it
 * was written: EIP-7702 is live, EntryPoint v0.7 is deployed, Kernel v3.3's 7702
 * delegate has code there, and Pimlico's bundler serves the chain.
 *
 * Gas: there is no paymaster. On Arc the native currency is USDC, so the user
 * operation's gas comes out of the same USDC balance the user is spending — the
 * planner already reserved room for it.
 */

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

/** EIP-7702 delegation designator: 0xef0100 followed by the delegate address. */
const DELEGATED_CODE = `0xef0100${KERNEL_7702_DELEGATION_ADDRESS.slice(2)}`.toLowerCase();

async function isDelegatedToKernel(address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return code?.toLowerCase() === DELEGATED_CODE;
}

interface PimlicoGasPrice {
  fast: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
}

export type SendStage = 'preparing' | 'authorizing' | 'submitting' | 'confirming';

/**
 * The operation was (or may have been) submitted, and its outcome is unknown.
 *
 * Distinct from an ordinary error on purpose: the screen must not offer a
 * retry for this one, because the first attempt may still land.
 */
export class SubmittedButUnconfirmedError extends Error {
  constructor(readonly userOpHash: Hex | null = null) {
    super('Submitted, but not confirmed yet.');
    this.name = 'SubmittedButUnconfirmedError';
  }
}

function isAmbiguousNetworkError(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return Boolean(error.walk((cause) => cause instanceof TimeoutError || cause instanceof HttpRequestError));
}

export function useSmartAccount() {
  const { wallets } = useEmbeddedEthereumWallet();
  const { signAuthorization } = useSign7702Authorization();

  const wallet = wallets[0];

  /**
   * Sign and submit a planned batch of calls. Resolves to the transaction hash
   * once the user operation is included — on Arc, that is final.
   */
  const sendCalls = useCallback(
    async (calls: readonly PreparedCall[], onStage?: (stage: SendStage) => void): Promise<Hex> => {
      if (!wallet) throw new Error('Your wallet is still being set up.');

      // The planner only builds Arc calls today. Refuse anything else outright
      // rather than signing a call against a chain this client isn't pointed at.
      if (calls.length === 0 || calls.some((call) => call.chainId !== arcTestnet.id)) {
        throw new Error('That transaction is not for Arc.');
      }

      onStage?.('preparing');

      const address = wallet.address.toLowerCase() as Address;
      const provider = await wallet.getProvider();

      // The delegation only needs signing once. Including it again would cost
      // the 25,000-gas authorization charge on every send for nothing.
      const delegated = await isDelegatedToKernel(address);

      let eip7702Auth: Awaited<ReturnType<typeof signAuthorization>> | undefined;
      if (!delegated) {
        onStage?.('authorizing');
        eip7702Auth = await signAuthorization({
          contractAddress: KERNEL_7702_DELEGATION_ADDRESS,
          chainId: arcTestnet.id,
        });
      }

      const account = await createKernelAccount(publicClient, {
        entryPoint: getEntryPoint('0.7'),
        kernelVersion: KERNEL_V3_3,
        eip7702Account: provider,
        eip7702Auth,
      });

      /*
       * With 7702 the smart account *is* the user's address. If the SDK ever
       * derived a different one — a counterfactual 4337 address, say — the
       * transfer would come from an account the planner never looked at. Stop.
       */
      if (account.address.toLowerCase() !== address) {
        throw new Error('Smart account address does not match your wallet. Nothing was sent.');
      }

      const client = createKernelAccountClient({
        account,
        chain: arcTestnet,
        client: publicClient,
        bundlerTransport: http(config.bundlerUrl),
        userOperation: {
          estimateFeesPerGas: async ({ bundlerClient }: { bundlerClient: Client }) => {
            const prices = (await bundlerClient.request({
              method: 'pimlico_getUserOperationGasPrice' as never,
              params: [] as never,
            })) as PimlicoGasPrice;

            return {
              maxFeePerGas: BigInt(prices.fast.maxFeePerGas),
              maxPriorityFeePerGas: BigInt(prices.fast.maxPriorityFeePerGas),
            };
          },
        },
      });

      onStage?.('submitting');

      let userOpHash: Hex;
      try {
        userOpHash = await client.sendUserOperation({
          calls: calls.map((call) => ({ to: call.to, data: call.data as Hex, value: BigInt(call.value) })),
        });
      } catch (error) {
        // A rejection from the bundler means nothing was submitted. A timeout or
        // dropped connection means we cannot know — it may have gone through.
        if (isAmbiguousNetworkError(error)) throw new SubmittedButUnconfirmedError();
        throw error;
      }

      onStage?.('confirming');

      /*
       * From here the operation is with the bundler. Any failure to *observe*
       * the result is not a failure of the send, and must never be reported as
       * one: the user would tap "try again" and pay twice.
       */
      let receipt: Awaited<ReturnType<typeof client.waitForUserOperationReceipt>>;
      try {
        receipt = await client.waitForUserOperationReceipt({ hash: userOpHash, timeout: 60_000 });
      } catch {
        throw new SubmittedButUnconfirmedError(userOpHash);
      }

      if (!receipt.success) {
        // Included, but the transfer itself reverted: the USDC did not move.
        throw new Error('The transaction failed on-chain. Nothing was sent.');
      }

      return receipt.receipt.transactionHash;
    },
    [wallet, signAuthorization],
  );

  return {
    address: (wallet?.address.toLowerCase() ?? null) as Address | null,
    ready: Boolean(wallet),
    sendCalls,
  };
}
