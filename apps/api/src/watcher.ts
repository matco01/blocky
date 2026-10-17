import { displayUsd, shortAddress, type Address, type ChainId } from '@blocky/shared';
import { isCrossChainContract, readUsdcTransfers, type ChainReader, type UsdcTransfer } from '@blocky/wallet-core';
import type { ChainCursor, ChainTransfer, Store } from './store';

/**
 * The chain watcher: Blocky's own record of money moving in and out of its
 * users' wallets on Arc, read from the chain through the endpoint the API
 * already uses — no explorer, no indexer, no other API. It is how Blocky
 * knows someone got paid while the app was closed, and what the activity
 * feed shows for money received.
 *
 * Two jobs:
 *
 *  - **The live edge** (`watchTransfers`), every few seconds: every USDC
 *    transfer in the blocks since last time — one `eth_getLogs` — kept where
 *    it touches a Blocky wallet, and the recipient told: "@sam sent you $20",
 *    in the inbox and as a push.
 *  - **History** (`readHistory`), once: on the first start, back from the
 *    oldest account to where the live edge began, filtered to Blocky's
 *    wallets. It fills the feed; nobody is told about the past.
 *
 * The live edge reads every transfer rather than filtering to Blocky's
 * wallets: a filter would have to name every wallet every few seconds, and
 * grow with every sign-up. All of Arc's USDC transfers over a few seconds are
 * a few dozen logs, and the database says which addresses are ours — always
 * current, with no list to keep in step.
 *
 * Both assume one API instance, like the other jobs — though running two
 * stores nothing twice and tells nobody twice (see `notify`'s key).
 */

/** How often the live edge is read. */
export const WATCH_MS = 15_000;

/**
 * Blocks left unread behind the newest. Arc's blocks are final when made, but
 * an endpoint is a pool of nodes, and a node a block behind answers for the
 * range it has without saying it stopped short. Three seconds' grace.
 */
export const LAG_BLOCKS = 6;

/** At most this many blocks a run: catching up after downtime goes in steps. */
export const MAX_WATCH_BLOCKS = 2_000;

/** Pause between history reads, so the backfill never crowds the live edge off a rate-limited endpoint. */
export const HISTORY_PAUSE_MS = 250;

/** History is read this many blocks at a time: within every endpoint's cap we've seen for a filtered query. */
export const HISTORY_BLOCKS = 5_000;

/** Wallets named in one filtered query — a request a few kilobytes long. */
const WALLETS_PER_QUERY = 100;

/** History starts this long before the oldest account, in case a wallet was funded the minute it was made. */
const HISTORY_MARGIN_MS = 60 * 60 * 1000;

/** Under a cent isn't news: it's dust, or someone poisoning the history with look-alike addresses. */
const NOTIFY_MIN_UNITS = 10_000n;

/** The live edge is behind if it hasn't read the chain in this long, and the feed says so. */
const STALE_MS = 2 * 60 * 1000;

/** How far back a move of the user's own counts as the reason money arrived. */
const OWN_MOVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const CLOCK_SLACK_MS = 2 * 60 * 1000;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface WatchDeps {
  store: Store;
  reader: ChainReader;
  /** The home chain: Arc. */
  chainId: ChainId;
  now?: () => Date;
}

/**
 * One run of the live edge. On the very first run it also decides where
 * history begins, from the oldest account.
 */
export async function watchTransfers({ store, reader, chainId, now = () => new Date() }: WatchDeps): Promise<void> {
  const safe = (await reader.blockNumber(chainId)) - LAG_BLOCKS;
  const cursor = (await store.getChainCursor(chainId)) ?? (await startWatching(store, reader, chainId, safe, now()));

  const from = cursor.block + 1;
  const to = Math.min(safe, cursor.block + MAX_WATCH_BLOCKS);
  if (to >= from) {
    const transfers = await readUsdcTransfers(reader, chainId, { from, to });
    const { ours, owners } = await keepOurs(store, transfers);

    await store.recordTransfers(chainId, ours);
    for (const transfer of ours) {
      const recipient = owners.get(transfer.to);
      if (recipient && transfer.from !== transfer.to) await tellRecipient(store, chainId, recipient, transfer, owners);
    }
  }

  // Even with nothing new: the edge read the chain just now, so the feed is current.
  await store.advanceChainCursor(chainId, Math.max(cursor.block, to), now());
}

/**
 * The first run: the live edge starts here, and history runs from the oldest
 * account up to it. No accounts yet means no history to read.
 */
async function startWatching(store: Store, reader: ChainReader, chainId: ChainId, head: number, now: Date): Promise<ChainCursor> {
  const users = await store.listUsers();
  const oldest = users.reduce<number | null>((min, user) => {
    const at = new Date(user.createdAt).getTime();
    return min === null || at < min ? at : min;
  }, null);

  const historyNext = oldest === null ? head + 1 : await blockAt(reader, chainId, head, new Date(oldest - HISTORY_MARGIN_MS));
  return store.startChainCursor(chainId, { block: head, historyNext, historyTo: head }, now);
}

/** The last block made at or before `time`: a binary search on block times, about 26 reads on a chain of 60 million blocks. */
export async function blockAt(reader: ChainReader, chainId: ChainId, head: number, time: Date): Promise<number> {
  if ((await reader.blockTime(chainId, head)) <= time) return head;
  let low = 0;
  let high = head;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if ((await reader.blockTime(chainId, middle)) <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

type Owner = { id: string; walletAddress: Address; username: string | null };

/** The transfers that touch a Blocky wallet, and who owns each wallet involved. */
async function keepOurs(store: Store, transfers: readonly UsdcTransfer[]): Promise<{ ours: UsdcTransfer[]; owners: Map<string, Owner> }> {
  const moved = transfers.filter((transfer) => transfer.amount > 0n);
  const owners = new Map(
    (await store.usersByWallets(moved.flatMap((transfer) => [transfer.from, transfer.to]))).map((owner) => [owner.walletAddress, owner]),
  );
  return { ours: moved.filter((transfer) => owners.has(transfer.from) || owners.has(transfer.to)), owners };
}

/**
 * Tell a Blocky user money arrived — once. A send made through Blocky is
 * told by the sender's own report instead (`afterMoneyMoved`), which knows
 * the request it paid; both use the same key, so whichever is second is
 * dropped.
 */
async function tellRecipient(store: Store, chainId: ChainId, recipient: Owner, transfer: UsdcTransfer, owners: Map<string, Owner>): Promise<void> {
  if (transfer.amount < NOTIFY_MIN_UNITS) return;
  if (await store.isBlockyTransaction(transfer.txHash)) return;

  const { title, body } = await describeArrival(store, chainId, recipient, transfer, owners);
  await store.notify(recipient.id, {
    kind: 'money_received',
    title,
    body,
    data: { txHash: transfer.txHash },
    key: receivedKey(transfer.txHash),
    at: transfer.at,
  });
}

/** The key that makes "you got paid" once per transaction, whoever notices it first. */
export function receivedKey(txHash: string): string {
  return `received:${txHash.toLowerCase()}`;
}

/**
 * "@sam sent you $20", in the words the user knows the sender by: their
 * Blocky name, then the user's own name for them, then — for an address
 * nobody has named — the address itself.
 */
async function describeArrival(
  store: Store,
  chainId: ChainId,
  recipient: Owner,
  transfer: UsdcTransfer,
  owners: Map<string, Owner>,
): Promise<{ title: string; body: string }> {
  const amount = displayUsd(transfer.amount);
  const landed = 'It’s in your wallet.';

  const sender = owners.get(transfer.from);
  if (sender?.username) return { title: `@${sender.username} sent you ${amount}`, body: landed };

  const contact = (await store.listContacts(recipient.id).catch(() => [])).find((c) => c.address.toLowerCase() === transfer.from);
  if (contact) return { title: `${contact.label} sent you ${amount}`, body: landed };

  // Their own money, back from another chain: the sender is a bridge's mint
  // or a relayer they've never heard of, never a person paying them.
  if (await isOwnMove(store, chainId, recipient.id, transfer)) {
    return { title: `Your ${amount} arrived`, body: 'The money you moved is in your wallet.' };
  }
  if (transfer.from === ZERO_ADDRESS || isCrossChainContract(transfer.from)) {
    return { title: `${amount} arrived from another network`, body: landed };
  }

  return { title: `You received ${amount}`, body: `From ${shortAddress(transfer.from)}. ${landed}` };
}

/** A move the user made from another chain in the hours before the money landed, to this one. */
async function isOwnMove(store: Store, chainId: ChainId, userId: string, transfer: UsdcTransfer): Promise<boolean> {
  const recent = (await store.listExecutions(userId, 10)).filter((execution) => {
    // Block times and our clock can disagree by a little; never by minutes.
    const before = transfer.at.getTime() - execution.createdAt.getTime();
    return execution.status !== 'reverted' && execution.chainId !== chainId && before > -CLOCK_SLACK_MS && before < OWN_MOVE_WINDOW_MS;
  });
  for (const execution of recent) {
    const stored = await store.getPlan(userId, execution.planId).catch(() => null);
    if (stored?.plan.inflow.some((delta) => delta.token.chainId === chainId)) return true;
  }
  return false;
}

/**
 * One step of history: the next few thousand blocks, filtered to Blocky's
 * wallets. `done` once it has met the live edge's start.
 */
export async function readHistory({ store, reader, chainId }: WatchDeps): Promise<'done' | 'reading' | 'waiting'> {
  const cursor = await store.getChainCursor(chainId);
  // The live edge decides where history ends; until its first run, wait.
  if (!cursor) return 'waiting';
  if (cursor.historyNext > cursor.historyTo) return 'done';

  const from = cursor.historyNext;
  const to = Math.min(cursor.historyTo, from + HISTORY_BLOCKS - 1);
  const wallets = (await store.listUsers()).map((user) => user.walletAddress);

  const found: UsdcTransfer[] = [];
  for (let i = 0; i < wallets.length; i += WALLETS_PER_QUERY) {
    const chunk = wallets.slice(i, i + WALLETS_PER_QUERY);
    found.push(...(await readUsdcTransfers(reader, chainId, { from, to }, { side: 'to', wallets: chunk })));
    found.push(...(await readUsdcTransfers(reader, chainId, { from, to }, { side: 'from', wallets: chunk })));
  }

  // Between two Blocky users, a transfer comes back from both queries; it's stored once.
  await store.recordTransfers(
    chainId,
    found.filter((transfer) => transfer.amount > 0n),
  );
  await store.advanceChainHistory(chainId, to + 1);
  return to + 1 > cursor.historyTo ? 'done' : 'reading';
}

/**
 * Read history until it's done, a step at a time, backing off when the
 * endpoint pushes back. Started once at boot and left to finish.
 */
export async function readAllHistory(deps: WatchDeps, options: { pauseMs?: number; onError?: (error: unknown) => void } = {}): Promise<void> {
  const pause = options.pauseMs ?? HISTORY_PAUSE_MS;
  let failures = 0;
  for (;;) {
    try {
      const state = await readHistory(deps);
      if (state === 'done') return;
      failures = 0;
      await sleep(state === 'waiting' ? WATCH_MS : pause);
    } catch (error) {
      failures++;
      options.onError?.(error);
      // A rate limit or a flaky endpoint: wait longer each time, up to a minute.
      await sleep(Math.min(pause * 2 ** failures, 60_000));
    }
  }
}

/**
 * A wallet's on-chain history for the activity feed, and whether it's the
 * whole story: history read in full, and the live edge current.
 */
export async function walletTransfers(
  store: Store,
  chainId: ChainId,
  wallet: Address,
  now = new Date(),
): Promise<{ transfers: ChainTransfer[]; complete: boolean }> {
  const [transfers, cursor] = await Promise.all([store.listTransfers(chainId, wallet), store.getChainCursor(chainId)]);
  const complete = cursor !== null && cursor.historyNext > cursor.historyTo && now.getTime() - cursor.updatedAt.getTime() < STALE_MS;
  return { transfers, complete };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
