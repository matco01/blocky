import { formatUsd, usdValueOf, type Address, type ChainId } from '@blocky/shared';
import { CHAINS } from './chains';
import { getPriceSnapshot, priceAsDecimal, type PriceSnapshot } from './prices';
import type { ChainReader } from './rpc';

/**
 * What else is in the wallet, beyond the spendable USDC balance on the home
 * chain and the Gateway deposits reported beside it.
 *
 * Two things per chain, on chains we have an RPC endpoint for: the native gas
 * token, and USDC — never a wider ERC-20 list. USDC is here because moving
 * money between chains puts it there, and a transfer that lands somewhere the
 * portfolio does not look reads as money that vanished. Its address comes from
 * the chain registry, which is already load-bearing for every send; anything
 * beyond that needs an indexer, not a guessed address.
 */
export interface TokenHolding {
  chainId: ChainId;
  symbol: string;
  /** Base units, as the node reports it. */
  amount: string;
  decimals: number;
  /** USD decimal string, display precision — null when we have no price for it. */
  usd: string | null;
  /** A dollar stablecoin: counted with the user's cash, not their investments. */
  stable: boolean;
}

/**
 * Scan every chain the reader supports. Arc is skipped: its native currency is
 * the same USDC the spendable balance already counts, and adding it again
 * would double it.
 *
 * One chain failing to answer never fails the rest — a dead RPC endpoint
 * degrades to "nothing found there", not a broken portfolio. Prices come from
 * the shared snapshot, so a full scan costs no price requests of its own.
 */
export async function fetchWalletHoldings(
  reader: ChainReader,
  owner: Address,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenHolding[]> {
  const chains = Object.values(CHAINS).filter(
    (chain) => chain.testnet && !chain.gasPaidInUsdc && reader.supports(chain.id),
  );

  const prices: PriceSnapshot | null = await getPriceSnapshot(fetchImpl).catch(() => null);

  const perChain = await Promise.all(
    chains.map(async (chain): Promise<TokenHolding[]> => {
      const [native, usdc] = await Promise.all([
        reader.nativeBalance(chain.id, owner).catch(() => 0n),
        reader.erc20Balance(chain.id, chain.usdc, owner).catch(() => 0n),
      ]);

      const holdings: TokenHolding[] = [];

      if (native > 0n) {
        const { symbol, decimals } = chain.nativeCurrency;
        const price = priceAsDecimal(prices?.get(symbol) ?? null);
        holdings.push({
          chainId: chain.id,
          symbol,
          amount: native.toString(),
          decimals,
          usd: price === null ? null : formatUsd(usdValueOf(native, decimals, price)),
          stable: false,
        });
      }

      if (usdc > 0n) {
        // USDC's six decimals are the dollar scale: the amount is its own value.
        holdings.push({ chainId: chain.id, symbol: 'USDC', amount: usdc.toString(), decimals: 6, usd: formatUsd(usdc), stable: true });
      }

      return holdings;
    }),
  );

  return perChain.flat();
}
