/**
 * App configuration from EXPO_PUBLIC_* variables.
 *
 * Everything here ships inside the app binary and is readable by anyone who has
 * it. That is fine for an app id or a URL; it is never fine for a secret, which
 * is why the Privy app secret and the Anthropic key live only on the server.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Copy apps/mobile/.env.example to apps/mobile/.env.`);
  }
  return value;
}

export const config = {
  privyAppId: required('EXPO_PUBLIC_PRIVY_APP_ID', process.env.EXPO_PUBLIC_PRIVY_APP_ID),
  privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID || undefined,
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787',
  bundlerUrl: process.env.EXPO_PUBLIC_BUNDLER_URL || 'https://public.pimlico.io/v2/5042002/rpc',
  /** Null means passkeys are not configured, and only email login is offered. */
  passkeyRelyingParty: process.env.EXPO_PUBLIC_PASSKEY_RP || null,
} as const;
