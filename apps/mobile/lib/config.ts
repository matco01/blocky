/**
 * App configuration from EXPO_PUBLIC_* variables.
 *
 * Everything here ships inside the app binary and is readable by anyone who has
 * it. That is fine for an app id or a URL; it is never fine for a secret, which
 * is why the Privy app secret and the Anthropic key live only on the server.
 */

import { DEFAULT_CHAIN } from '@blocky/wallet-core';

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Copy apps/mobile/.env.example to apps/mobile/.env.`);
  }
  return value;
}

/**
 * The bundler is per chain, and a Pimlico URL says which chain in its path.
 * A testnet bundler URL left in place after switching to mainnet (or the
 * reverse) would submit to the wrong network, so a mismatch stops the app at
 * startup instead of at the first send.
 */
function bundlerUrl(): string {
  const url = process.env.EXPO_PUBLIC_BUNDLER_URL || `https://public.pimlico.io/v2/${DEFAULT_CHAIN}/rpc`;
  const chainInUrl = /pimlico\.io\/v2\/(\d+)\//.exec(url)?.[1];

  if (chainInUrl && Number(chainInUrl) !== DEFAULT_CHAIN) {
    throw new Error(
      `EXPO_PUBLIC_BUNDLER_URL is for chain ${chainInUrl}, but this build is on chain ${DEFAULT_CHAIN}. Check EXPO_PUBLIC_NETWORK.`,
    );
  }

  return url;
}

export const config = {
  privyAppId: required('EXPO_PUBLIC_PRIVY_APP_ID', process.env.EXPO_PUBLIC_PRIVY_APP_ID),
  privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID || undefined,
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787',
  bundlerUrl: bundlerUrl(),
  /** Null means passkeys are not configured, and only email login is offered. */
  passkeyRelyingParty: process.env.EXPO_PUBLIC_PASSKEY_RP || null,
} as const;
