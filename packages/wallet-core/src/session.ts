import { parseUnits, type Address, type ChainId, type Policy } from '@blocky/shared';
import { usdcAddress } from './chains';

/**
 * Session keys: the agent's hands, and the limits on them.
 *
 * The server-side policy engine in `@blocky/shared` decides what the agent
 * *should* do. This decides what it *can* do, and the difference is the entire
 * safety argument: these permissions are installed in the Kernel validator and
 * enforced by the chain. If our API is compromised tomorrow, an attacker with
 * full server access still cannot exceed the caps encoded here.
 *
 * So the on-chain limits must be derived from the same policy the user set, and
 * must never be looser. `deriveSessionPermissions` is the only place that
 * translation happens.
 */

/** ERC-20 `transfer(address,uint256)`. */
const ERC20_TRANSFER = '0xa9059cbb';
/** ERC-20 `approve(address,uint256)`. */
const ERC20_APPROVE = '0x095ea7b3';

export interface CallPermission {
  /** Contract the session key may call. */
  target: Address;
  /** Function selectors permitted on that target. */
  selectors: string[];
}

export interface SpendLimit {
  token: Address;
  /** Cap in the token's base units, over the whole session. */
  limit: bigint;
}

export interface SessionPermissions {
  chainId: ChainId;
  /** Public address of the agent's key. Never leaves the server. */
  signerAddress: Address;
  calls: CallPermission[];
  spendLimits: SpendLimit[];
  /** Unix seconds. Short by design — see `SESSION_TTL_SECONDS`. */
  validUntil: number;
}

/**
 * Sessions are deliberately short-lived.
 *
 * A long-lived session key is a long-lived liability: it widens the window in
 * which a stolen key is useful, and it lets a spend limit that the user set
 * once quietly authorise activity for months. Re-minting is cheap; a stale
 * unlimited-feeling key is not.
 */
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Translate a user policy into on-chain permissions.
 *
 * Two rules govern this function:
 *
 *  1. It may only ever *narrow*. If you find yourself widening a permission to
 *     make a feature work, the feature is wrong.
 *  2. It grants per-target, per-selector access — never a blanket "any call".
 *     An agent that can call any function on any contract is an agent that can
 *     drain the wallet through a contract we have never heard of.
 */
export function deriveSessionPermissions(args: {
  policy: Policy;
  chainId: ChainId;
  signerAddress: Address;
  now?: Date;
}): SessionPermissions {
  const { policy, chainId, signerAddress } = args;
  const now = args.now ?? new Date();

  const calls: CallPermission[] = [];
  const spendLimits: SpendLimit[] = [];

  if (policy.allowedActions.includes('transfer')) {
    const usdc = usdcAddress(chainId);

    calls.push({ target: usdc, selectors: [ERC20_TRANSFER] });

    /*
     * The on-chain cap is the *daily* cap, not the per-transaction cap. The
     * per-tx cap is enforced server-side; the daily cap is the one that must
     * survive a compromised server, because it bounds total loss rather than
     * loss per attempt.
     */
    spendLimits.push({ token: usdc, limit: parseUnits(policy.dailyCapUsd, 6) });
  }

  /*
   * Swaps stay off until M5. When they land, the target set is the aggregator's
   * router only, with `approve` scoped to that same router — not a wildcard.
   */
  if (policy.allowedActions.includes('swap')) {
    void ERC20_APPROVE; // referenced when swap permissions are implemented
    throw new Error('Swap session permissions are not implemented yet (M5)');
  }

  return {
    chainId,
    signerAddress,
    calls,
    spendLimits,
    validUntil: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  };
}

/** True once a session can no longer sign. */
export function isSessionExpired(
  permissions: SessionPermissions,
  now: Date = new Date(),
): boolean {
  return permissions.validUntil * 1000 <= now.getTime();
}
