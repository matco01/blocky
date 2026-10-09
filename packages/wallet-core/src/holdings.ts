import { formatUsd, usdValueOf, type Address, type ChainId } from '@blocky/shared';
import { cached, uncache } from './cache';
import { chainsOnNetwork } from './chains';
import { STOCKS } from './stocks';
import { getPriceSnapshot, getTokenPricesByAddress, priceAsDecimal, type PriceSnapshot } from './prices';
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
  /** The token's contract, for one bought by address — what a sale has to name it by. */
  address?: Address;
}

/**
 * A token the user holds that no list knows about — a memecoin they bought by
 * its contract. The server remembers it once bought, so it shows up here.
 */
export interface TrackedToken {
  chainId: ChainId;
  address: Address;
  symbol: string;
  decimals: number;
}

/**
 * How long a wallet's scan of the other chains is reused.
 *
 * The scan is the expensive read (two or more calls on each of nine chains),
 * and the money it finds rarely moves on its own: almost everything that lands
 * there arrives through a Blocky send, swap or bridge, and those clear the
 * cache the moment they settle. Opening Portfolio or pulling to refresh asks
 * for a fresh scan too. This TTL is only the safety net for money sent in from
 * outside Blocky, so it can be long; the Home balance poll stays cheap.
 */
const HOLDINGS_TTL_MS = 120_000;

/**
 * Scan every chain on this network that the reader supports. Arc is skipped:
 * its native currency is the same USDC the spendable balance already counts,
 * and adding it again would double it.
 *
 * One chain failing to answer never fails the rest — a dead RPC endpoint
 * degrades to "nothing found there", not a broken portfolio. Prices come from
 * the shared snapshot, and a wallet's scan is reused for {@link HOLDINGS_TTL_MS}:
 * on mainnet it is two reads on each of nine chains, which is not something
 * to repeat on every ten-second balance poll.
 */
export function fetchWalletHoldings(
  reader: ChainReader,
  owner: Address,
  fetchImpl: typeof fetch = fetch,
  tracked: readonly TrackedToken[] = [],
): Promise<TokenHolding[]> {
  return cached(fetchImpl, `holdings:${owner.toLowerCase()}`, HOLDINGS_TTL_MS, () => scan(reader, owner, fetchImpl, tracked));
}

/** Forget a wallet's cached scan — after money moves, so the next read sees it. */
export function forgetWalletHoldings(owner: Address, fetchImpl: typeof fetch = fetch): void {
  uncache(fetchImpl, `holdings:${owner.toLowerCase()}`);
}

async function scan(
  reader: ChainReader,
  owner: Address,
  fetchImpl: typeof fetch,
  tracked: readonly TrackedToken[],
): Promise<TokenHolding[]> {
  const chains = chainsOnNetwork().filter((chain) => !chain.gasPaidInUsdc && reader.supports(chain.id));

  const prices: PriceSnapshot | null = await getPriceSnapshot(fetchImpl).catch(() => null);

  const perChain = await Promise.all(
    chains.map(async (chain): Promise<TokenHolding[]> => {
      const stocks = STOCKS.filter((s) => s.chainId === chain.id);
      const [native, usdc, stockBalances] = await Promise.all([
        reader.nativeBalance(chain.id, owner).catch(() => 0n),
        chain.usdc ? reader.erc20Balance(chain.id, chain.usdc, owner).catch(() => 0n) : Promise.resolve(0n),
        Promise.all(stocks.map((s) => reader.erc20Balance(chain.id, s.address, owner).catch(() => 0n))),
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

      // Stocks, from the pinned list only — the same addresses a buy pays into.
      stocks.forEach((s, i) => {
        const amount = stockBalances[i]!;
        if (amount === 0n) return;
        const price = priceAsDecimal(prices?.get(s.symbol) ?? null);
        holdings.push({
          chainId: chain.id,
          symbol: s.symbol,
          amount: amount.toString(),
          decimals: s.decimals,
          usd: price === null ? null : formatUsd(usdValueOf(amount, s.decimals, price)),
          stable: false,
        });
      });

      return holdings;
    }),
  );

  return [...perChain.flat(), ...(await scanTracked(reader, owner, fetchImpl, tracked, chains.map((c) => c.id)))];
}

/** Tokens bought by contract: balance and a price by address, on chains we can read. */
async function scanTracked(
  reader: ChainReader,
  owner: Address,
  fetchImpl: typeof fetch,
  tracked: readonly TrackedToken[],
  readable: readonly ChainId[],
): Promise<TokenHolding[]> {
  const tokens = tracked.filter((token) => readable.includes(token.chainId));
  if (tokens.length === 0) return [];

  const [balances, prices] = await Promise.all([
    Promise.all(tokens.map((token) => reader.erc20Balance(token.chainId, token.address, owner).catch(() => 0n))),
    getTokenPricesByAddress(tokens, fetchImpl).catch(() => new Map()),
  ]);

  return tokens.flatMap((token, i): TokenHolding[] => {
    const amount = balances[i]!;
    if (amount === 0n) return [];
    const price = priceAsDecimal(prices.get(`${token.chainId}:${token.address.toLowerCase()}`) ?? null);
    return [
      {
        chainId: token.chainId,
        symbol: token.symbol,
        amount: amount.toString(),
        decimals: token.decimals,
        usd: price === null ? null : formatUsd(usdValueOf(amount, token.decimals, price)),
        stable: false,
        address: token.address,
      },
    ];
  });
}
