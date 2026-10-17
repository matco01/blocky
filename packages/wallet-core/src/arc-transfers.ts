import type { Address, ChainId } from '@blocky/shared';
import { nativeToUsdcUnitsDown } from './chains';
import { TRANSFER_TOPIC } from './receipts';
import type { ChainLog, ChainReader, LogFilter } from './rpc';

/**
 * Every dollar that moves on Arc, read from the chain itself — no explorer,
 * no indexer, just the endpoint we already use.
 *
 * Arc's USDC is both the native currency and an ERC-20, and the two show up
 * differently in logs (checked on testnet and mainnet):
 *
 *  - a native send (`value` on a plain transaction) emits one `Transfer`, from
 *    a system address, at 18 decimals;
 *  - an ERC-20 `transfer` emits that same system `Transfer` *and* the token
 *    contract's own, at 6 decimals.
 *
 * So the system address's `Transfer`s are every movement exactly once. The
 * token contract's alone would miss native sends; both would count every
 * token transfer twice. Gas emits nothing.
 */
export const ARC_TRANSFER_EMITTER: Address = '0xfffffffffffffffffffffffffffffffffffffffe';

export interface UsdcTransfer {
  /** Lowercased. */
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /** Lowercased. A mint (money arriving from another chain through CCTP) is from the zero address. */
  from: Address;
  to: Address;
  /** 6-decimal USDC units. */
  amount: bigint;
  /** When the block was made. */
  at: Date;
}

/** The `Transfer` a system log describes, or null for any other log. */
export function decodeUsdcTransfer(log: ChainLog, blockTime: Date): UsdcTransfer | null {
  if (log.address.toLowerCase() !== ARC_TRANSFER_EMITTER) return null;
  if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(log.data)) return null;

  return {
    txHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    from: topicAddress(log.topics[1]!),
    to: topicAddress(log.topics[2]!),
    amount: nativeToUsdcUnitsDown(BigInt(log.data)),
    at: blockTime,
  };
}

/** Only the transfers to — or only those from — a set of wallets. */
export interface WalletMatch {
  side: 'from' | 'to';
  wallets: readonly Address[];
}

/**
 * USDC transfers on Arc in an inclusive block range: all of them, or only
 * those to (or from) some wallets.
 *
 * A range the endpoint refuses as too wide is halved and asked again, down to
 * a single block. Anything else — a rate limit, a timeout — throws: the caller
 * tries the same range again later rather than skipping it.
 */
export async function readUsdcTransfers(
  reader: ChainReader,
  chainId: ChainId,
  range: { from: number; to: number },
  match?: WalletMatch,
): Promise<UsdcTransfer[]> {
  if (range.to < range.from) return [];
  if (match && match.wallets.length === 0) return [];

  const addresses = match ? match.wallets.map(topicOf) : null;
  const logs = await readLogs(reader, chainId, {
    address: ARC_TRANSFER_EMITTER,
    topics: !addresses ? [TRANSFER_TOPIC] : match!.side === 'to' ? [TRANSFER_TOPIC, null, addresses] : [TRANSFER_TOPIC, addresses],
    fromBlock: range.from,
    toBlock: range.to,
  });

  // Arc's nodes put the block's time on every log. One that doesn't costs a
  // block read per block with a transfer in it, never a guessed time.
  const times = new Map<number, Date>();
  for (const log of logs) {
    if (!log.blockTimestamp && !times.has(log.blockNumber)) {
      times.set(log.blockNumber, await reader.blockTime(chainId, log.blockNumber));
    }
  }

  return logs
    .map((log) => decodeUsdcTransfer(log, log.blockTimestamp ?? times.get(log.blockNumber)!))
    .filter((transfer): transfer is UsdcTransfer => transfer !== null);
}

/** Ranges are halved at most this many times: a thousand blocks down to one. */
const MAX_SPLITS = 12;

/**
 * `getLogs`, narrowing the range until the endpoint accepts it. Every
 * provider has its own ceiling — Arc's public endpoint answers 5,000 blocks
 * but not 10,000, and caps some nodes at 2,000 results — and none of them
 * says so up front.
 */
export async function readLogs(reader: ChainReader, chainId: ChainId, filter: LogFilter, splits = 0): Promise<ChainLog[]> {
  try {
    return await reader.getLogs(chainId, filter);
  } catch (error) {
    if (!isRangeRefusal(error) || filter.toBlock <= filter.fromBlock || splits >= MAX_SPLITS) throw error;

    const middle = filter.fromBlock + Math.floor((filter.toBlock - filter.fromBlock) / 2);
    const first = await readLogs(reader, chainId, { ...filter, toBlock: middle }, splits + 1);
    const second = await readLogs(reader, chainId, { ...filter, fromBlock: middle + 1 }, splits + 1);
    return [...first, ...second];
  }
}

/**
 * Whether an endpoint refused a log query for its size — too many blocks or
 * too many results — as opposed to failing it. Providers word this every way
 * there is ("requested range too large", "query exceeds max results 2000",
 * "Log response size exceeded", "query returned more than 10000 results"), so
 * this reads the words, not a code: -32005 means "too many results" to one
 * provider and "slow down" to another.
 */
export function isRangeRefusal(error: unknown): boolean {
  const text = messagesOf(error);
  if (/rate.?limit|too many requests/i.test(text) || statusOf(error) === 429) return false;
  return /range|too large|too big|max results|more than \d+ results|response size|too many (results|logs)/i.test(text);
}

/**
 * The words in an error and the errors it wraps — viem puts the node's own a
 * level or two down, in `details`. Never viem's full `message`: that carries
 * the endpoint URL (and any key in it) and the request body.
 */
function messagesOf(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
    const { details, shortMessage, message } = e as Record<string, unknown>;
    if (typeof details === 'string' || typeof shortMessage === 'string') {
      parts.push(String(details ?? ''), String(shortMessage ?? ''));
    } else if (typeof message === 'string') {
      parts.push(message);
    }
  }
  return parts.join(' | ');
}

function statusOf(error: unknown): number | null {
  for (let e: unknown = error, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
    const status = (e as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

function topicAddress(topic: string): Address {
  return `0x${topic.slice(-40)}`.toLowerCase() as Address;
}

function topicOf(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}
