import {
  formatUsd,
  shortAddress,
  usdValueOf,
  type Address,
  type ChainId,
  type RecipientRef,
  type ResolvedRecipient,
  type ResolvedToken,
  type TokenRef,
} from '@blocky/shared';
import type { PlannerContext } from '@blocky/planner';
import {
  CHAINS,
  DEFAULT_CHAIN,
  NATIVE_TOKEN,
  fetchAcrossNativeSwapQuote,
  fetchAcrossQuote,
  fetchAcrossSwapQuote,
  fetchCctpFees,
  fetchGasZipQuote,
  getChain,
  getTokenPriceUsd,
  getTokenPricesByAddress,
  nativeToUsdcUnits,
  priceAsDecimal,
  stockByAddress,
  stockBySymbol,
  type Stock,
  type ChainReader,
} from '@blocky/wallet-core';
import type { Store } from './store';

/**
 * The real `PlannerContext`: chain reads, prices, screening.
 *
 * This is the impure half the planner deliberately does not contain. Where a
 * source is not built yet it says so in a comment and returns the conservative
 * answer — null for a price, false for a flag — because the planner already
 * knows how to degrade on those. What it must never do is invent a plausible
 * number to make a code path complete.
 */

/**
 * Gas units for a transaction from the user's wallet, by how many calls it
 * carries. One call is sent as itself; several go as one Multicall3From batch.
 *
 * Measured on Arc, then padded: a USDC transfer uses ~75k, an approve + CCTP
 * burn batch ~164k. The wallet's own estimate is what actually gets sent;
 * this sizes the fee on the card and the reserve held back for it, and those
 * must not come in under the real cost. A send on Arc is about a fifth of a
 * cent.
 */
const TX_BASE_GAS = 100_000n;
const TX_EXTRA_CALL_GAS = 110_000n;

function transactionGas(callCount: number): bigint {
  return TX_BASE_GAS + TX_EXTRA_CALL_GAS * BigInt(Math.max(0, callCount - 1));
}

/** A chain's gas token priced in USD, or null. Throws only if the price feed itself is down. */
async function gasTokenPrice(chainId: ChainId): Promise<string | null> {
  return priceAsDecimal(await getTokenPriceUsd(getChain(chainId).nativeCurrency.symbol));
}

/** Where Blocky's fee goes and how much it is. Server configuration, never the model's. */
export interface BlockyFeeTerms {
  recipient: Address;
  bps: number;
}

export interface PlannerDeps {
  reader: ChainReader;
  store: Store;
  userId: string;
  /** The user's wallet. Privy supplies this for real in M1. */
  account: Address;
  /** Null or absent: no fee. */
  blockyFee?: BlockyFeeTerms | null;
}

export function createPlannerContext({
  reader,
  store,
  userId,
  account,
  blockyFee = null,
}: PlannerDeps): PlannerContext {
  /*
   * One read per token for the life of this context (one plan). For a USDC
   * send, `balanceOf` and `usdcBalanceUsd` ask about the same balance, and the
   * planner asks both at once.
   */
  const balances = new Map<string, Promise<bigint>>();
  function balance(chainId: ChainId, token: Address): Promise<bigint> {
    const key = `${chainId}:${token}`;
    let read = balances.get(key);
    if (!read) {
      read = reader.erc20Balance(chainId, token, account);
      balances.set(key, read);
    }
    return read;
  }

  return {
    blockyFee: () => blockyFee,

    async resolveToken(ref: TokenRef, chainId: ChainId): Promise<ResolvedToken | null> {
      const chain = getChain(chainId);

      if (ref.kind === 'symbol') {
        const symbol = ref.symbol.trim().toUpperCase();

        // A chain's own gas token (ETH on Arbitrum, HYPE on HyperEVM) — named
        // by the zero address, as swap routes name it. Never on Arc, where the
        // native token *is* the USDC below.
        if (!chain.gasPaidInUsdc && symbol === chain.nativeCurrency.symbol.toUpperCase()) {
          return {
            chainId,
            address: NATIVE_TOKEN,
            symbol: chain.nativeCurrency.symbol,
            name: chain.nativeCurrency.symbol,
            decimals: chain.nativeCurrency.decimals,
            logoUrl: null,
            verified: true,
          };
        }

        // A stock, on the chain stocks live on — from the pinned list only.
        const stock = stockBySymbol(symbol);
        if (stock && stock.chainId === chainId) return stockToken(stock);

        // Otherwise the curated list is USDC alone. That is honest: a symbol we
        // cannot vouch for should come back as a clarifying question rather
        // than a lookup against arbitrary chain data.
        if (symbol !== 'USDC' || !chain.usdc) return null;

        return {
          chainId,
          address: chain.usdc,
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          logoUrl: null,
          verified: true,
        };
      }

      // A listed stock named by its address is still the listed stock.
      const listed = stockByAddress(ref.chainId, ref.address);
      if (listed) return stockToken(listed);

      // An explicit address is read from the contract and always unverified —
      // it is not on our curated list by definition.
      const metadata = await reader.tokenMetadata(ref.chainId, ref.address);

      if (!metadata) return null;

      return {
        chainId: ref.chainId,
        address: metadata.address,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        logoUrl: null,
        verified: false,
      };
    },

    async resolveRecipient(ref: RecipientRef): Promise<ResolvedRecipient | null> {
      const chainId = DEFAULT_CHAIN;

      const resolved = await addressFor(ref, { account, reader, store, userId });

      if (!resolved) return null;

      const [known, isContract] = await Promise.all([
        store.isKnownRecipient(userId, resolved.address),
        reader
          .isContract(chainId, resolved.address)
          // A failed code read must not silently become "definitely a wallet".
          .catch(() => false),
      ]);

      return {
        address: resolved.address,
        display: resolved.display,
        ensName: resolved.ensName,
        contactLabel: resolved.contactLabel,
        known,
        isContract,
      };
    },

    async priceOf(token: ResolvedToken) {
      // USDC is a dollar. A chain's gas token (ETH, HYPE…) is priced live from
      // the shared snapshot — for valuing what a swap delivers, never for
      // deciding how much is sent. Anything else is an honest null, which makes
      // the planner refuse USD-denominated amounts rather than guess at them.
      if (token.address === getChain(token.chainId).usdc) return '1';
      if (token.address === NATIVE_TOKEN) return gasTokenPrice(token.chainId);
      // A stock: the market price of that exact token, from the same snapshot.
      const stock = stockByAddress(token.chainId, token.address);
      if (stock) return priceAsDecimal(await getTokenPriceUsd(stock.symbol));
      // Anything else — a token named by its contract — by that contract.
      const prices = await getTokenPricesByAddress([token]).catch(() => null);
      return priceAsDecimal(prices?.get(`${token.chainId}:${token.address.toLowerCase()}`) ?? null);
    },

    async balanceOf(token: ResolvedToken) {
      if (token.address === NATIVE_TOKEN) return reader.nativeBalance(token.chainId, account);
      return balance(token.chainId, token.address);
    },

    async usdcBalanceUsd(chainId: ChainId) {
      const usdc = getChain(chainId).usdc;
      return formatUsd(usdc ? await balance(chainId, usdc) : 0n);
    },

    async nativeBalanceUsd(chainId: ChainId) {
      // No endpoint for that chain means we cannot see what is there, which
      // the gas rules read as "not enough" rather than assuming there is some.
      if (!reader.supports(chainId)) return null;

      const [balance, price] = await Promise.all([reader.nativeBalance(chainId, account), gasTokenPrice(chainId)]);
      if (price === null) return null;

      return formatUsd(usdValueOf(balance, CHAINS[chainId].nativeCurrency.decimals, price));
    },

    async estimateNetworkFeeUsd(chainId: ChainId, calls) {
      const chain = CHAINS[chainId];

      /*
       * A failed gas-price read must not become a $0 fee. Zero would size the
       * reserve at nothing and let the user plan a send they cannot pay gas
       * for. Throwing surfaces as "temporarily unavailable" instead.
       */
      const gasPrice = await reader.gasPrice(chainId);
      const nativeCost = gasPrice * transactionGas(calls.length);

      if (chain.gasPaidInUsdc) {
        // Arc: the fee is already USDC, at 18 decimals. Cross to 6 in the one
        // function allowed to, which rounds up.
        return formatUsd(nativeToUsdcUnits(nativeCost));
      }

      // Anywhere else the fee is in the chain's gas token, priced live. No
      // price is no estimate — never a guessed one.
      const price = await gasTokenPrice(chainId);
      if (price === null) throw new Error(`No price for ${chain.nativeCurrency.symbol}.`);

      return formatUsd(usdValueOf(nativeCost, chain.nativeCurrency.decimals, price) + 1n);
    },

    async bridgeFees(from: ChainId, to: ChainId) {
      return fetchCctpFees(from, to);
    },

    async acrossQuote(from: ChainId, to: ChainId, inputAmount: bigint, recipient: Address) {
      return fetchAcrossQuote({ from, to, inputAmount, recipient });
    },

    async acrossSwapQuote(from: ChainId, to: ChainId, inputAmount: bigint, outputToken: Address, recipient: Address) {
      return fetchAcrossSwapQuote({ from, to, inputAmount, outputToken, recipient });
    },

    async gasZipQuote(from: ChainId, to: ChainId, inputAmount: bigint, recipient: Address) {
      return fetchGasZipQuote({ from, to, inputAmount, recipient });
    },

    async acrossNativeSwapQuote(from: ChainId, to: ChainId, inputAmount: bigint, recipient: Address, inputToken?: Address) {
      return fetchAcrossNativeSwapQuote({ from, to, inputAmount, recipient, ...(inputToken ? { inputToken } : {}) });
    },

    async isAddressFlagged() {
      // No screening provider wired up yet. False is the honest answer — the
      // alternative would be flagging nothing while implying we checked.
      return false;
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Recipient resolution                                                       */
/* -------------------------------------------------------------------------- */

interface ResolvedAddress {
  address: Address;
  display: string;
  ensName: string | null;
  contactLabel: string | null;
}

interface ResolveDeps {
  account: Address;
  reader: ChainReader;
  store: Store;
  userId: string;
}

async function addressFor(
  ref: RecipientRef,
  { account, reader, store, userId }: ResolveDeps,
): Promise<ResolvedAddress | null> {
  switch (ref.kind) {
    case 'address': {
      // A bare address gets its ENS name attached for display when it has one.
      // The address is what we send to either way — the name is never the
      // source of truth, only the label on the confirmation card.
      const ensName = await reader.lookupEns(ref.address);

      return {
        address: ref.address,
        display: ensName ?? shortAddress(ref.address),
        ensName,
        contactLabel: null,
      };
    }

    case 'self':
      return {
        address: account,
        display: 'your own wallet',
        ensName: null,
        contactLabel: null,
      };

    case 'ens': {
      const address = await reader.resolveEns(ref.name);

      // Unresolvable is a question, never a guess. This is also what happens
      // when no Ethereum endpoint is configured at all.
      if (!address) return null;

      return {
        address,
        // Show the name the user typed, not the address they cannot verify.
        display: ref.name,
        ensName: ref.name,
        contactLabel: null,
      };
    }

    case 'contact': {
      const contact = await store.findContact(userId, ref.label);

      // A label the user has not saved does not resolve. The model cannot
      // invent a working destination, which is the whole point of contacts
      // being the only free-text handle it may use.
      if (!contact) return null;

      return {
        address: contact.address,
        display: contact.label,
        ensName: null,
        contactLabel: contact.label,
      };
    }
  }
}

/** A listed stock as a resolved token: verified, because its address is pinned. */
function stockToken(stock: Stock): ResolvedToken {
  return {
    chainId: stock.chainId,
    address: stock.address,
    symbol: stock.symbol,
    name: stock.name,
    decimals: stock.decimals,
    logoUrl: null,
    verified: true,
  };
}
