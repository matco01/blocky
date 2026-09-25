/**
 * Which network this build talks to: real money, or test money.
 *
 * One switch for the whole stack, read once at startup — `EXPO_PUBLIC_NETWORK`
 * in the app (inlined at build time, so it must be spelled out literally
 * below), `BLOCKY_NETWORK` on the server. Anything other than exactly
 * `mainnet` is testnet: a typo or a missing setting must land on test money,
 * never on real money.
 *
 * The app and the server have to agree. They check each other rather than
 * trusting it: every planned call carries its chain id, and the app refuses
 * to sign one for a chain it isn't on.
 */

export type Network = 'mainnet' | 'testnet';

function readNetwork(): Network {
  if (typeof process === 'undefined' || !process.env) return 'testnet';
  const value = process.env.EXPO_PUBLIC_NETWORK ?? process.env.BLOCKY_NETWORK;
  return value === 'mainnet' ? 'mainnet' : 'testnet';
}

export const NETWORK: Network = readNetwork();

export const IS_TESTNET = NETWORK === 'testnet';
