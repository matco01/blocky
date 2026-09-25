import { transactionsOf, type Address, type PreparedCall } from '@blocky/shared';
import { transactionFor } from '@blocky/wallet-core';
import { useEmbeddedEthereumWallet } from '@privy-io/expo';
import { useCallback } from 'react';
import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  createWalletClient,
  custom,
  http,
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
 * How a plan's calls become transactions is shared with the server, which
 * verifies each one byte for byte: consecutive calls without value go as one
 * all-or-nothing Multicall3From batch; a call carrying value (a Gas.zip
 * deposit) goes on its own. See `transactionsOf` and `transactionFor`.
 */

const publicClient = createPublicClient({ chain: homeChain, transport: http() });

export type SendStage = 'preparing' | 'submitting' | 'confirming';

export interface SendResult {
  /** One per transaction that landed, in plan order. The first always carries the money. */
  hashes: Hex[];
  /** A later, extra transaction (a gas top-up) did not go through, or its outcome is unknown. */
  extrasFailed: boolean;
}

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

export function useWallet() {
  const { wallets } = useEmbeddedEthereumWallet();
  const wallet = wallets[0];

  /**
   * Sign and send a plan's calls, transaction by transaction, in order.
   * Resolves once each is included — on Arc, that is final.
   *
   * The first transaction carries the money, and fails the whole send if it
   * fails. Anything after it (a gas top-up) is extra: if one does not go
   * through, the money has still moved, and saying "failed" would invite the
   * user to send it again — so it is reported, not thrown.
   */
  const sendCalls = useCallback(
    async (calls: readonly PreparedCall[], onStage?: (stage: SendStage) => void): Promise<SendResult> => {
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
      const transactions = transactionsOf(calls).map(transactionFor);
      const walletClient = createWalletClient({
        account: address,
        chain: homeChain,
        transport: custom(await wallet.getProvider()),
      });

      const hashes: Hex[] = [];

      for (const [index, transaction] of transactions.entries()) {
        try {
          hashes.push(await sendOne(walletClient, transaction, index === 0 ? onStage : undefined));
        } catch (error) {
          if (index === 0) throw error;
          return { hashes, extrasFailed: true };
        }
      }

      return { hashes, extrasFailed: false };
    },
    [wallet],
  );

  return {
    address: (wallet?.address.toLowerCase() ?? null) as Address | null,
    ready: Boolean(wallet),
    sendCalls,
  };
}

/** Send one transaction and wait for it to land. */
async function sendOne(
  walletClient: ReturnType<typeof createWalletClient>,
  transaction: ReturnType<typeof transactionFor>,
  onStage?: (stage: SendStage) => void,
): Promise<Hex> {
  onStage?.('submitting');

  let hash: Hex;
  try {
    hash = await walletClient.sendTransaction({ ...transaction, account: walletClient.account!, chain: homeChain });
  } catch (error) {
    // A rejection means nothing was submitted. A timeout or dropped
    // connection means we cannot know — it may have gone through.
    if (isAmbiguousNetworkError(error)) throw new SubmittedButUnconfirmedError();
    throw error;
  }

  onStage?.('confirming');

  /*
   * From here the transaction is out. Any failure to *observe* the result is
   * not a failure of the send, and must never be reported as one: the user
   * would tap "try again" and pay twice.
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
}
