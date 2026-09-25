import { transactionsOf, type Address, type ChainId, type Hex, type PreparedCall } from '@blocky/shared';
import { encodeFunctionData, parseAbi } from 'viem';
import { getChain } from './chains';

/**
 * How planned calls become transactions — written once, so the app that sends
 * them and the server that verifies them cannot disagree about the bytes.
 *
 * One call goes as itself. Several go as one transaction through Arc's
 * Multicall3From, which runs each call *as the sender* (Arc's CallFrom
 * precompile) and reverts all of them if any one fails. Verified on the live
 * chain: an approval inside the batch is the wallet's own, and a batch with a
 * failing call reverts whole.
 */

/** Arc's Multicall3From, at the same address on mainnet and testnet. */
export const MULTICALL_FROM: Address = '0x522faf9a91c41c443c66765030741e4aace147d0';

const MULTICALL_FROM_ABI = parseAbi([
  'function aggregate((address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)',
]);

/** Only Arc has Multicall3From. Everywhere else, every call is its own transaction. */
export function supportsBatching(chainId: number): boolean {
  return getChain(chainId as ChainId)?.gasPaidInUsdc === true;
}

/** A plan's calls as the transactions they go out as, in order — what the app sends and the server verifies. */
export function groupCalls(calls: readonly PreparedCall[]): PreparedCall[][] {
  return transactionsOf(calls, supportsBatching);
}

export interface OutgoingTransaction {
  to: Address;
  data: Hex;
  value: bigint;
}

/** The single transaction for one group of calls (see `transactionsOf`). */
export function transactionFor(calls: readonly PreparedCall[]): OutgoingTransaction {
  if (calls.length === 0) throw new Error('Nothing to send.');

  if (calls.length === 1) {
    const [call] = calls as [PreparedCall];
    return { to: call.to, data: call.data as Hex, value: BigInt(call.value) };
  }

  // Multicall3From is not payable: a batched call can never carry value.
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

/**
 * Is this exactly the transaction these calls make, sent by this wallet, and
 * did it succeed? The strongest check there is: byte-identical calldata to the
 * same contract with the same value means it did precisely what the user
 * approved — used for legs whose effects are not a simple event to read, like
 * a swap whose instructions run on another chain.
 */
export function isExactTransaction(
  sent: { from: string; to: string | null; value: bigint; input: string } | undefined,
  status: 'success' | 'reverted',
  expected: { from: Address; calls: readonly PreparedCall[] },
): boolean {
  if (!sent || status !== 'success') return false;

  const tx = transactionFor(expected.calls);
  return (
    sent.from.toLowerCase() === expected.from.toLowerCase() &&
    sent.to?.toLowerCase() === tx.to.toLowerCase() &&
    sent.value === tx.value &&
    sent.input.toLowerCase() === tx.data.toLowerCase()
  );
}
