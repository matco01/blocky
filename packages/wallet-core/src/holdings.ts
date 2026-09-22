import { formatUnits, formatUsd, type Address, type ChainId } from '@blocky/shared';
import { CHAINS } from './chains';
import { getTokenPriceUsd } from './prices';
import type { ChainReader } from './rpc';

/**
 * What else is in the wallet, beyond the spendable USDC balance and the
 * Gateway deposits the planner already reports.
 *
 * Native currency only, on chains we have an RPC endpoint for — never a
 * curated ERC-20 address list. A wrong token address here is a wrong balance
 * shown with total confidence; a wrong RPC endpoint just means a chain we
 * skip. Real arbitrary-token discovery needs an indexer, not a guess.
 */
export interface TokenHolding {
  chainId: ChainId;
  symbol: string;
  /** Base units, as the node reports it. */
  amount: string;
  decimals: number;
  /** USD decimal string, display precision — null when we have no price for it. */
  usd: string | null;
}

/**
 * Scan every chain the reader supports for a native-currency balance worth
 * reporting. Arc is skipped: its native currency is the same USDC the
 * spendable balance already counts, and adding it again would double it.
 *
 * One chain failing to answer never fails the rest — a dead RPC endpoint
 * degrades to "nothing found there", not a broken portfolio.
 */
export async function fetchWalletHoldings(
  reader: ChainReader,
  owner: Address,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenHolding[]> {
  const chains = Object.values(CHAINS).filter(
    (chain) => chain.testnet && !chain.gasPaidInUsdc && reader.supports(chain.id),
  );

  const results = await Promise.all(
    chains.map(async (chain): Promise<TokenHolding | null> => {
      const amount = await reader.nativeBalance(chain.id, owner).catch(() => 0n);
      if (amount <= 0n) return null;

      const price = await getTokenPriceUsd(chain.nativeCurrency.symbol, fetchImpl).catch(() => null);
      const usd = price
        ? formatUsd(BigInt(Math.round(Number(formatUnits(amount, chain.nativeCurrency.decimals)) * price.usd * 1e6)))
        : null;

      return { chainId: chain.id, symbol: chain.nativeCurrency.symbol, amount: amount.toString(), decimals: chain.nativeCurrency.decimals, usd };
    }),
  );

  return results.filter((holding): holding is TokenHolding => holding !== null);
}
