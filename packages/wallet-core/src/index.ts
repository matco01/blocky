/**
 * @blocky/wallet-core — chains, chain reads, Circle Gateway, prices, session
 * keys, and who pays for gas.
 *
 * Everything here is read-only or pure. Signing is not: it happens on the
 * device, in `apps/mobile/lib/smart-account.ts`, because that is where the
 * key is — so that file talks to Privy, ZeroDev and viem directly.
 */

export * from './network';
export * from './chains';
export * from './session';
export * from './gas';
export * from './rpc';
export * from './receipts';
export * from './gateway';
export * from './cctp';
export * from './prices';
export * from './ecosystem';
export * from './holdings';
