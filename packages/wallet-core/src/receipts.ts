import type { Address } from '@blocky/shared';

/**
 * Reading what a transaction actually did.
 *
 * The app tells us "I submitted plan X, here is the hash". We do not take its
 * word for it: the hash could belong to any transaction. The receipt has to
 * contain the exact transfer the plan describes — right token contract, right
 * sender, right recipient, right amount — or it is not an execution of that
 * plan.
 */

export interface ReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface Receipt {
  status: 'success' | 'reverted';
  logs: readonly ReceiptLog[];
}

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface ExpectedTransfer {
  /** The ERC-20 contract that must have emitted the log. */
  token: Address;
  from: Address;
  to: Address;
  /** In the token's own base units. */
  amount: bigint;
}

/**
 * Does this receipt contain exactly this ERC-20 transfer?
 *
 * The emitter must be the token contract itself. That matters on Arc, where a
 * native USDC send emits an identically-shaped `Transfer` from a system address
 * at 18 decimals: counting that as a match would accept a transaction that is
 * not the planned call, at an amount a trillion times off.
 */
export function containsTransfer(receipt: Receipt, expected: ExpectedTransfer): boolean {
  if (receipt.status !== 'success') return false;

  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== expected.token.toLowerCase()) return false;
    if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return false;

    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    if (from !== expected.from.toLowerCase() || to !== expected.to.toLowerCase()) return false;

    const amount = wordToBigint(log.data);
    return amount !== null && amount === expected.amount;
  });
}

/** An indexed address topic is the address left-padded to 32 bytes. */
function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(26)}`.toLowerCase();
}

function wordToBigint(data: string): bigint | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  return BigInt(data);
}
