import { ENTRY_POINT_V07 } from '@blocky/wallet-core';
import { formatUsd, type Address } from '@blocky/shared';
import type { Execution } from './store';

/**
 * The activity feed: what moved in and out of the wallet.
 *
 * Two sources, merged:
 *
 *  - **ArcScan** (Blockscout) for everything on-chain, including money the user
 *    *received*, which we would otherwise never know about.
 *  - **Our own executions**, which carry the human summary and show a send the
 *    moment it is submitted, before the explorer has indexed it.
 *
 * Arc has a trap here that an explorer happens to solve: a native USDC send
 * emits only a system-level Transfer event at 18 decimals, while an ERC-20
 * transfer emits both that and a 6-decimal one. Indexing only the ERC-20
 * contract misses native sends; indexing both double-counts. Verified against
 * the live testnet: ArcScan's USDC token-transfer list includes native sends,
 * already normalised to 6 decimals and de-duplicated.
 */

export interface ActivityItem {
  id: string;
  direction: 'sent' | 'received';
  txHash: string;
  counterparty: Address;
  /** USDC, as a 6-decimal decimal string. */
  amount: string;
  status: 'pending' | 'success' | 'reverted';
  /** Our summary for sends we planned; null for anything we only saw on-chain. */
  summary: string | null;
  timestamp: string;
}

export interface ExplorerTransfer {
  txHash: string;
  logIndex: number;
  from: Address;
  to: Address;
  /** 6-decimal base units. */
  value: bigint;
  timestamp: string;
}

interface BlockscoutTransfer {
  transaction_hash: string;
  log_index: number;
  from: { hash: string };
  to: { hash: string };
  total: { decimals: string; value: string };
  timestamp: string;
}

/**
 * Recent USDC transfers touching an address, from a Blockscout explorer.
 *
 * Throws on failure; the caller shows the feed as unavailable rather than
 * empty, because "no activity" is a claim about the user's money.
 */
export async function fetchExplorerTransfers(
  address: Address,
  options: { apiBase: string; token: Address; fetch?: typeof fetch },
): Promise<ExplorerTransfer[]> {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.apiBase}/addresses/${address}/token-transfers?type=ERC-20&token=${options.token}`;

  const response = await doFetch(url, { headers: { accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Explorer request failed with ${response.status}`);
  }

  const body = (await response.json()) as { items?: BlockscoutTransfer[] };

  return (body.items ?? [])
    .filter((item) => item.total.decimals === '6' && /^\d+$/.test(item.total.value))
    .map((item) => ({
      txHash: item.transaction_hash.toLowerCase(),
      logIndex: item.log_index,
      from: item.from.hash.toLowerCase() as Address,
      to: item.to.hash.toLowerCase() as Address,
      value: BigInt(item.total.value),
      timestamp: item.timestamp,
    }));
}

/** Merge on-chain transfers with our own records into one newest-first feed. */
export function mergeActivity(
  wallet: Address,
  executions: readonly Execution[],
  transfers: readonly ExplorerTransfer[],
): ActivityItem[] {
  const self = wallet.toLowerCase();
  const items: ActivityItem[] = [];
  const indexed = new Set(transfers.map((transfer) => transfer.txHash));

  for (const transfer of transfers) {
    const sent = transfer.from === self;
    const received = transfer.to === self;
    if (!sent && !received) continue;

    /*
     * Gas, not a send. On Arc the native token is USDC, so a user operation
     * pays its prefund as a USDC transfer to the EntryPoint — which the
     * explorer reports like any other transfer, in the same transaction as the
     * real one. Listing it would put a second row under every send, addressed
     * to a contract the user has never heard of, usually for $0.00.
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
      summary: execution?.summary ?? null,
      timestamp: transfer.timestamp,
    });
  }

  // Our sends the explorer has not indexed yet still belong in the feed.
  for (const execution of executions) {
    if (indexed.has(execution.txHash)) continue;

    items.push({
      id: execution.id,
      direction: 'sent',
      txHash: execution.txHash,
      counterparty: execution.counterparty,
      amount: execution.amount,
      status: execution.status,
      summary: execution.summary,
      timestamp: execution.createdAt.toISOString(),
    });
  }

  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
