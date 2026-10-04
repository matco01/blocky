import type { Address, PreparedCall } from '@blocky/shared';
import { groupCalls, transactionFor } from '@blocky/wallet-core';
import { useEmbeddedEthereumWallet } from '@privy-io/expo';
import { useCallback } from 'react';
import {
  BaseError,
  ExecutionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  TimeoutError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  numberToHex,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from 'viem';
import { homeChain, homeChainName, signingChain } from './chain';

/**
 * The user's wallet: their Privy embedded wallet, sending ordinary
 * transactions — on Arc, and on the other chains of this network when money
 * moved there has to come back.
 *
 * No smart account, no bundler, no paymaster. On Arc the gas token *is* USDC,
 * so a plain transaction pays its own fee out of the balance being spent. On
 * another chain it pays in that chain's gas token, which the planner has
 * already checked the user holds.
 *
 * How a plan's calls become transactions is shared with the server, which
 * verifies each one byte for byte: on Arc, consecutive calls without value go
 * as one all-or-nothing Multicall3From batch; everywhere else, and for any
 * call carrying value, each call is its own transaction. See `groupCalls`.
 */

export type SendStage = 'preparing' | 'submitting' | 'confirming';

export interface SendResult {
  /** One per transaction that landed, in plan order. */
  hashes: Hex[];
  /** The optional last transaction (a gas top-up) did not go through, or its outcome is unknown. */
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

/**
 * What a wallet error means, in a sentence — never viem's dump of the request.
 *
 * On a chain whose gas is its own token, a "revert" at estimation is almost
 * always the wallet unable to cover value plus its maximum fee: nodes report
 * that as a bare revert, not as insufficient funds.
 */
function friendlyError(error: unknown, chain: Chain): Error {
  if (!(error instanceof BaseError)) return error instanceof Error ? error : new Error(String(error));
  if (error.walk((cause) => cause instanceof UserRejectedRequestError)) {
    return new Error('You cancelled it. Nothing was sent.');
  }
  if (error.walk((cause) => cause instanceof InsufficientFundsError || cause instanceof ExecutionRevertedError)) {
    return new Error(
      chain.id === homeChain.id
        ? `${homeChainName} wouldn't accept it — there may not be enough left for the network fee. Nothing was sent.`
        : `Not enough ${chain.nativeCurrency.symbol} left on ${chain.name} to cover its network fee. Nothing was sent — try a slightly smaller amount.`,
    );
  }
  return new Error(`${error.shortMessage} Nothing was sent.`);
}

export function useWallet() {
  const { wallets } = useEmbeddedEthereumWallet();
  const wallet = wallets[0];

  /**
   * Sign and send a plan's calls, transaction by transaction, in order, each
   * on its own chain. Resolves once each is included.
   *
   * Every transaction that moves the money must land, or the send fails. Only
   * a trailing extra (`optionalLast` — a gas top-up) may fail on its own: the
   * money has already moved by then, and saying "failed" would invite the
   * user to send it again — so that is reported, not thrown.
   */
  const sendCalls = useCallback(
    async (
      calls: readonly PreparedCall[],
      options: { optionalLast?: boolean; onStage?: (stage: SendStage) => void } = {},
    ): Promise<SendResult> => {
      if (!wallet) throw new Error('Your wallet is still being set up.');

      // Only chains this build signs on. A call for any other — including one
      // from a server on the other network — is refused before anything is signed.
      if (calls.length === 0 || calls.some((call) => !signingChain(call.chainId))) {
        throw new Error(`That transaction isn't for ${homeChainName} or a chain Blocky signs on. Nothing was signed.`);
      }

      options.onStage?.('preparing');

      const address = wallet.address.toLowerCase() as Address;
      const provider = (await wallet.getProvider()) as EIP1193Provider;
      const groups = groupCalls(calls);
      const required = groups.length - (options.optionalLast && groups.length > 1 ? 1 : 0);
      const hashes: Hex[] = [];

      for (const [index, group] of groups.entries()) {
        const chain = signingChain(group[0]!.chainId)!;
        try {
          hashes.push(await sendOne(provider, address, chain, transactionFor(group), options.onStage));
        } catch (error) {
          if (index < required) throw error;
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

/** Send one transaction on `chain` and wait for it to land there. */
async function sendOne(
  provider: EIP1193Provider,
  address: Address,
  chain: Chain,
  transaction: ReturnType<typeof transactionFor>,
  onStage?: (stage: SendStage) => void,
): Promise<Hex> {
  // Point the embedded wallet at the chain this transaction belongs to. A
  // wallet left on the wrong chain would sign for the wrong network.
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(chain.id) }] });

  const walletClient = createWalletClient({ account: address, chain, transport: custom(provider) });

  onStage?.('submitting');

  let hash: Hex;
  try {
    hash = await walletClient.sendTransaction({ ...transaction, account: address, chain });
  } catch (error) {
    // A rejection means nothing was submitted. A timeout or dropped
    // connection means we cannot know — it may have gone through.
    if (isAmbiguousNetworkError(error)) throw new SubmittedButUnconfirmedError();
    throw friendlyError(error, chain);
  }

  onStage?.('confirming');

  /*
   * From here the transaction is out. Any failure to *observe* the result is
   * not a failure of the send, and must never be reported as one: the user
   * would tap "try again" and pay twice.
   */
  let receipt: Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>;
  try {
    // Watched through the wallet's own connection first — the one that just
    // sent it, and so already sees it — falling back to the public endpoint.
    // A public endpoint alone was slow and rate-limited enough on Ethereum to
    // leave people on "Confirming…" long after the money had moved.
    const watcher = createPublicClient({ chain, transport: fallback([custom(provider), http()]), pollingInterval: 2_000 });
    receipt = await watcher.waitForTransactionReceipt({ hash, timeout: 120_000 });
  } catch {
    throw new SubmittedButUnconfirmedError(hash);
  }

  if (receipt.status !== 'success') {
    // Included, but it reverted: the money did not move.
    throw new Error('The transaction failed on-chain. Nothing was sent.');
  }

  return hash;
}
