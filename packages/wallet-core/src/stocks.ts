import { CHAIN, type Address, type ChainId } from '@blocky/shared';

/**
 * Stocks: tokenized US shares on Robinhood Chain.
 *
 * Each is an ordinary ERC-20 (18 decimals) issued by Robinhood Assets (Jersey)
 * that tracks one share — economic exposure, not shareholder rights. They
 * trade 24/7 in pools on Robinhood Chain, so buying one is a swap like any
 * other: USDC on Arc in, the stock out, through Across.
 *
 * ⚠️ Load-bearing like USDC's address: anyone can deploy a token called
 * "AAPL". These are the canonical ones — taken from Across's token list for
 * chain 4663 and checked on-chain (`name()` reads "… • Robinhood Token", 18
 * decimals) — and a symbol not listed here is not a stock Blocky will buy.
 *
 * Dividends and splits don't change balances: Robinhood adjusts a per-token
 * multiplier instead, and the market price of the token already includes it.
 */

export interface Stock {
  symbol: string;
  /** How a person says it: "Apple", not "AAPL". */
  name: string;
  address: Address;
  chainId: ChainId;
  decimals: 18;
  /** An ETF rather than a single company. */
  fund: boolean;
}

const stock = (symbol: string, name: string, address: string, fund = false): Stock => ({
  symbol,
  name,
  address: address.toLowerCase() as Address,
  chainId: CHAIN.robinhood,
  decimals: 18,
  fund,
});

export const STOCKS: readonly Stock[] = [
  stock('AAPL', 'Apple', '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'),
  stock('MSFT', 'Microsoft', '0xe93237C50D904957Cf27E7B1133b510C669c2e74'),
  stock('NVDA', 'Nvidia', '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'),
  stock('AMZN', 'Amazon', '0x12f190a9F9d7D37a250758b26824B97CE941bF54'),
  stock('GOOGL', 'Alphabet (Google)', '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3'),
  stock('META', 'Meta', '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35'),
  stock('TSLA', 'Tesla', '0x322F0929c4625eD5bAd873c95208D54E1c003b2d'),
  stock('AVGO', 'Broadcom', '0x156E175DD063a8cE274C50654eF40e0032b3fbcF'),
  stock('AMD', 'AMD', '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC'),
  stock('NFLX', 'Netflix', '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8'),
  stock('ORCL', 'Oracle', '0xb0992820E760d836549ba69BC7598b4af75dEE03'),
  stock('PLTR', 'Palantir', '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A'),
  stock('COIN', 'Coinbase', '0x6330D8C3178a418788dF01a47479c0ce7CCF450b'),
  stock('MSTR', 'Strategy (MicroStrategy)', '0xec262a75e413fAfD0dF80480274532C79D42da09'),
  stock('CRCL', 'Circle', '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5'),
  stock('SPY', 'S&P 500 ETF', '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', true),
  stock('QQQ', 'Nasdaq-100 ETF', '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', true),
];

/** A listed stock by ticker, case-insensitive — or null: never a guess. */
export function stockBySymbol(symbol: string): Stock | null {
  const wanted = symbol.trim().toUpperCase();
  return STOCKS.find((s) => s.symbol === wanted) ?? null;
}

/** A listed stock by its contract, on its chain. */
export function stockByAddress(chainId: ChainId, address: Address): Stock | null {
  const wanted = address.toLowerCase();
  return STOCKS.find((s) => s.chainId === chainId && s.address === wanted) ?? null;
}

/** The chain stocks live on. */
export const STOCK_CHAIN: ChainId = CHAIN.robinhood;
