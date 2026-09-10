import {
  CHAIN,
  formatUnits,
  type Address,
  type ChainId,
  type RecipientRef,
  type ResolvedRecipient,
  type ResolvedToken,
  type TokenRef,
} from '@blocky/shared';
import type { PlannerContext } from '@blocky/planner';
import { CHAINS, getChain, type ChainReader } from '@blocky/wallet-core';
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

/** Gas units an ERC-20 transfer costs. Conservative; a real estimate replaces it per-call. */
const ERC20_TRANSFER_GAS = 65_000n;

export interface PlannerDeps {
  reader: ChainReader;
  store: Store;
  userId: string;
  /** The user's wallet. Privy supplies this for real in M1. */
  account: Address;
}

export function createPlannerContext({
  reader,
  store,
  userId,
  account,
}: PlannerDeps): PlannerContext {
  return {
    async accountAddress() {
      return account;
    },

    async resolveToken(ref: TokenRef, chainId: ChainId): Promise<ResolvedToken | null> {
      const chain = getChain(chainId);

      if (ref.kind === 'symbol') {
        // The curated list is exactly one token today. That is honest: USDC is
        // the product, and a symbol we cannot vouch for should come back as a
        // clarifying question rather than a lookup against arbitrary chain data.
        if (ref.symbol.toUpperCase() !== 'USDC') return null;

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
      const chainId = CHAIN.baseSepolia;

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
      // USDC is a dollar. Everything else needs a price feed, which lands with
      // swaps in M5 — until then an honest null, which makes the planner refuse
      // USD-denominated amounts rather than guess at them.
      return token.address === getChain(token.chainId).usdc ? '1' : null;
    },

    async balanceOf(token: ResolvedToken) {
      return reader.erc20Balance(token.chainId, token.address, account);
    },

    async usdcBalanceUsd(chainId: ChainId) {
      const balance = await reader.erc20Balance(chainId, getChain(chainId).usdc, account);

      return formatUnits(balance, 6);
    },

    async hasNativeBalance(chainId: ChainId) {
      return (await reader.nativeBalance(chainId, account)) > 0n;
    },

    async lifetimeTxCount() {
      // M0's store has no transaction history. Zero means a new user, which
      // errs toward sponsoring gas — the safe direction to be wrong in, since
      // it costs us money rather than stranding the user.
      return 0;
    },

    async estimateNetworkFeeUsd(chainId: ChainId) {
      const chain = CHAINS[chainId];
      const gasPrice = await reader.gasPrice(chainId).catch(() => 0n);

      const weiCost = gasPrice * ERC20_TRANSFER_GAS;

      // Native token priced in USD is a feed we do not have yet. On the L2s we
      // run on this is fractions of a cent; the number becomes real when the
      // price feed lands with M5.
      const nativeUsdPrice = chain.nativeCurrency.symbol === 'ETH' ? 3000n : 1n;

      return formatUnits((weiCost * nativeUsdPrice) / 10n ** 12n, 6);
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
        display: ensName ?? truncate(ref.address),
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

function truncate(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
