import { ENTRY_POINT_V07, getChain, isCrossChainContract } from '@blocky/wallet-core';
import { formatUsd, type Address, type ChainId } from '@blocky/shared';
import type { ChainTransfer, Contact, Execution, PublicUser, StoredPlan } from './store';

/**
 * The activity feed: what moved in and out of the wallet.
 *
 * Two sources, merged:
 *
 *  - **The chain**, as Blocky's own watcher read it (`watcher.ts`): every USDC
 *    transfer to or from the wallet on Arc, including money the user
 *    *received*, which we would otherwise never know about.
 *  - **Our own executions**, which carry the human summary and show a send the
 *    moment it is submitted, before the watcher has read its block.
 */

export interface ActivityItem {
  id: string;
  direction: 'sent' | 'received';
  txHash: string;
  counterparty: Address;
  /** USDC, as a 6-decimal decimal string. */
  amount: string;
  status: 'pending' | 'success' | 'reverted';
  /**
   * A headline for rows where "Sent to 0x…" would mislead — money moved to
   * the user's own wallet on another chain goes *to* a bridge contract (CCTP's
   * minter, an Across SpokePool, Gas.zip) they have never heard of — and the
   * same for money arriving that way, *from* a mint. Null means the app words
   * it itself.
   */
  title: string | null;
  /** Our summary for sends we planned; null for anything we only saw on-chain. */
  summary: string | null;
  timestamp: string;
  /** What the detail sheet shows when the row is tapped. Filled by `describeActivity`. */
  details?: ActivityDetails;
}

/** An amount of something, somewhere: "0.002 ETH on Base". */
export interface AssetLine {
  amount: string;
  symbol: string;
  chain: string;
  /** Dollar value at the time, when we had a price. */
  usd: string | null;
}

/**
 * Everything the app can say about one row, in words. Built from the plan for
 * a send Blocky made, so a swap says what went in and what came out; for money
 * that only showed up on-chain, from the transfer itself.
 */
export interface ActivityDetails {
  /** What left the wallet. */
  sent: AssetLine | null;
  /** What arrived — on the user's side for a swap or a move, the recipient's for a send. */
  received: AssetLine | null;
  /** The other side in words: "@sam", "Mum", "maria.eth", "Your wallet on Base". Null when all we have is an address. */
  party: string | null;
  /** All fees together, for sends Blocky made. */
  feeUsd: string | null;
  /** The network the transaction ran on. */
  network: string;
  /** Who carried it between chains: "Circle (CCTP)", "Across". */
  via: string | null;
  /** Asked for in chat, or from the Send screen. Null for anything only seen on-chain. */
  origin: 'agent' | 'manual' | null;
  /** The transaction on a block explorer. */
  explorerUrl: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ROUTE_NAMES: Record<string, string> = {
  cctp: 'Circle (CCTP)',
  across: 'Across',
  'across-swap': 'Across',
  'gas.zip': 'Gas.zip',
};

export interface DescribeContext {
  homeChain: ChainId;
  getPlan(planId: string): Promise<StoredPlan | null>;
  contacts: readonly Contact[];
  findUserByWallet(address: Address): Promise<PublicUser | null>;
}

/**
 * Add the detail sheet's facts to each row. One plan read per Blocky send, and
 * one name lookup per distinct address, so a full feed stays a few dozen
 * cheap database reads. A lookup that fails costs that row its extra detail,
 * never the feed.
 */
export async function describeActivity(
  items: readonly ActivityItem[],
  executions: readonly Execution[],
  ctx: DescribeContext,
): Promise<ActivityItem[]> {
  const byHash = new Map(executions.map((execution) => [execution.txHash, execution]));

  // A name for each address: a contact's label first, then a Blocky username.
  const names = new Map<string, string | null>();
  await Promise.all(
    [...new Set(items.map((item) => item.counterparty.toLowerCase()))].map(async (address) => {
      const contact = ctx.contacts.find((c) => c.address.toLowerCase() === address);
      if (contact) return names.set(address, contact.label);
      const user = await ctx.findUserByWallet(address as Address).catch(() => null);
      names.set(address, user ? `@${user.username}` : null);
    }),
  );

  return Promise.all(
    items.map(async (item): Promise<ActivityItem> => {
      const execution = byHash.get(item.txHash);
      const stored = execution ? await ctx.getPlan(execution.planId).catch(() => null) : null;
      const chainId = execution?.chainId ?? ctx.homeChain;
      const chain = getChain(chainId);
      const explorerUrl = `${chain.explorerUrl}/tx/${item.txHash}`;
      const named = names.get(item.counterparty.toLowerCase()) ?? null;

      if (!stored) {
        // Only seen on-chain: USDC on the home chain, the amount the chain reported.
        const line: AssetLine = { amount: item.amount, symbol: 'USDC', chain: chain.name, usd: item.amount };
        return {
          ...item,
          details: {
            sent: item.direction === 'sent' ? line : null,
            received: item.direction === 'received' ? line : null,
            party: named,
            feeUsd: null,
            network: chain.name,
            via: null,
            origin: execution?.origin ?? null,
            explorerUrl,
          },
        };
      }

      const { plan, origin } = stored;
      const out = plan.outflow[0];
      const into = plan.inflow[0];
      const line = (delta: typeof out): AssetLine | null =>
        delta
          ? {
              amount: delta.displayAmount,
              symbol: delta.token.symbol,
              chain: getChain(delta.token.chainId).name,
              usd: delta.usdValue,
            }
          : null;
      const between = plan.intentType === 'bridge';
      const destination = into ? getChain(into.token.chainId).name : null;

      return {
        ...item,
        details: {
          sent: line(out),
          received: line(into),
          party: between
            ? destination && destination !== chain.name
              ? `Your wallet on ${destination}`
              : 'Your wallet'
            : (plan.recipient?.contactLabel ?? named ?? plan.recipient?.ensName ?? null),
          feeUsd: plan.fee.totalUsd,
          network: chain.name,
          via: plan.route ? (ROUTE_NAMES[plan.route.provider] ?? plan.route.provider) : null,
          origin,
          explorerUrl,
        },
      };
    }),
  );
}

/**
 * The feed's on-chain half, and whether it's the whole story. Not complete
 * while the watcher is still reading history or has fallen behind: then the
 * feed says some of it may be missing, because "no activity" is a claim about
 * the user's money.
 */
export interface WalletTransfers {
  transfers: ChainTransfer[];
  complete: boolean;
}

/** Merge on-chain transfers with our own records into one newest-first feed. */
export function mergeActivity(
  wallet: Address,
  executions: readonly Execution[],
  transfers: readonly ChainTransfer[],
): ActivityItem[] {
  const self = wallet.toLowerCase();
  const items: ActivityItem[] = [];
  const indexed = new Set(transfers.map((transfer) => transfer.txHash));

  for (const transfer of transfers) {
    const sent = transfer.from === self;
    const received = transfer.to === self;
    if (!sent && !received) continue;

    /*
     * Gas, not a send — from when sends went out as ERC-4337 user operations,
     * and still in older wallets' history. On Arc the native token is USDC, so
     * a user operation paid its prefund as a USDC transfer to the EntryPoint,
     * which the chain reports like any other transfer. Listing it would put
     * a second row under the send, addressed to a contract the user has never
     * heard of, usually for $0.00. Sends today are ordinary transactions, which
     * leave no such transfer.
     *
     * The fee belongs on the confirmation card and nowhere else.
     */
    if (sent && transfer.to === ENTRY_POINT_V07) continue;

    const execution = sent ? executions.find((e) => e.txHash === transfer.txHash) : undefined;

    items.push({
      id: `${transfer.txHash}:${transfer.logIndex}`,
      // A transfer to yourself reads as received; it is the rarer case.
      direction: sent && !received ? 'sent' : 'received',
      txHash: transfer.txHash,
      counterparty: sent ? transfer.to : transfer.from,
      amount: formatUsd(transfer.value),
      status: execution?.status ?? 'success',
      title: sent
        ? isCrossChainContract(transfer.to)
          ? 'Moved to another chain'
          : null
        : // A mint (CCTP) or a bridge paying out has no one behind it to name.
          transfer.from === ZERO_ADDRESS || isCrossChainContract(transfer.from)
          ? 'Arrived from another chain'
          : null,
      summary: execution?.summary ?? null,
      timestamp: transfer.timestamp,
    });
  }

  // Our sends the watcher has not read yet, and moves on other chains, still belong in the feed.
  for (const execution of executions) {
    if (indexed.has(execution.txHash)) continue;

    items.push({
      id: execution.id,
      direction: 'sent',
      txHash: execution.txHash,
      counterparty: execution.counterparty,
      amount: execution.amount,
      status: execution.status,
      title: isCrossChainContract(execution.counterparty) ? 'Moving to another chain' : null,
      summary: execution.summary,
      timestamp: execution.createdAt.toISOString(),
    });
  }

  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
