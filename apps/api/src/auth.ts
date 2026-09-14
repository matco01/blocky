import { PrivyClient } from '@privy-io/node';
import type { Address } from '@blocky/shared';
import type { Store } from './store';

/**
 * Who is calling, and which wallet is theirs.
 *
 * Two facts, from two different places, and neither from the client:
 *
 *  - the user id comes from a Privy access token whose signature we verify;
 *  - the wallet address comes from Privy's API, looked up by that user id.
 *
 * The app never tells us its own address. If it could, a stolen token plus a
 * forged address header would let one user plan transfers out of another
 * user's wallet — the planner would read the wrong balance and the policy
 * engine would judge the wrong history.
 */

export interface IdentityProvider {
  /** The user id in a valid access token, or null for anything invalid or expired. */
  verifyAccessToken(token: string): Promise<string | null>;
  /** The user's Privy embedded Ethereum wallet, or null if they have none yet. */
  embeddedWalletAddress(userId: string): Promise<Address | null>;
}

export interface AuthenticatedUser {
  id: string;
  /** Null until Privy has created the embedded wallet, which happens on first login. */
  walletAddress: Address | null;
}

export function createPrivyIdentity(options: { appId: string; appSecret: string }): IdentityProvider {
  const privy = new PrivyClient({ appId: options.appId, appSecret: options.appSecret });

  return {
    async verifyAccessToken(token) {
      try {
        // Verifies signature, issuer, audience (our app id) and expiry against
        // Privy's published keys, which the client fetches and caches.
        const claims = await privy.utils().auth().verifyAccessToken(token);
        return claims.user_id;
      } catch {
        return null;
      }
    },

    async embeddedWalletAddress(userId) {
      const user = await privy.users()._get(userId);

      const wallets = user.linked_accounts
        .filter(
          (account): account is typeof account & { address: string; wallet_index: number } =>
            account.type === 'wallet' &&
            'chain_type' in account &&
            account.chain_type === 'ethereum' &&
            'connector_type' in account &&
            account.connector_type === 'embedded' &&
            'wallet_client_type' in account &&
            account.wallet_client_type === 'privy',
        )
        // The first embedded wallet is the account. Later indices are
        // additional wallets a user created deliberately, not their main one.
        .sort((a, b) => a.wallet_index - b.wallet_index);

      const primary = wallets[0];
      return primary ? (primary.address.toLowerCase() as Address) : null;
    },
  };
}

/**
 * Resolve a request's bearer token to a user.
 *
 * The wallet address is cached in our database once known. An embedded wallet's
 * address never changes, so there is nothing to invalidate — and it keeps a
 * Privy API call off every request.
 */
export async function authenticate(
  authorization: string | undefined,
  identity: IdentityProvider,
  store: Store,
): Promise<AuthenticatedUser | null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const userId = await identity.verifyAccessToken(token);
  if (!userId) return null;

  const known = await store.getUser(userId);
  if (known) return { id: known.id, walletAddress: known.walletAddress };

  const walletAddress = await identity.embeddedWalletAddress(userId);

  // Only persist once there is a wallet. Before that we ask Privy again on the
  // next request, which is exactly as long as it takes the app to create one.
  if (walletAddress) {
    await store.upsertUser({ id: userId, walletAddress });
  }

  return { id: userId, walletAddress };
}
