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

/* -------------------------------------------------------------------------- */
/*  Authorising calls against a session                                        */
/* -------------------------------------------------------------------------- */

/**
 * The server-side mirror of the on-chain validator.
 *
 * The Kernel validator is the real guarantee — it holds even if this server is
 * fully compromised. This exists so a call that the chain would reject is
 * refused here first, with an explanation, instead of being submitted and
 * failing as an opaque revert the user pays gas for.
 *
 * It must never be *more* permissive than the validator. When in doubt about
 * whether something is allowed, refuse: a false refusal is an inconvenience, a
 * false authorisation is someone's money.
 */
export type CallAuthorisation =
  | { ok: true }
  | { ok: false; code: SessionDenialCode; message: string };

export type SessionDenialCode =
  | 'session_expired'
  | 'wrong_chain'
  | 'target_not_permitted'
  | 'selector_not_permitted'
  | 'native_value_not_permitted'
  | 'over_spend_limit'
  | 'undecodable_call';

/** The first four bytes of calldata: which function is being called. */
export function selectorOf(data: string): string | null {
  return /^0x[0-9a-fA-F]{8}/.test(data) ? data.slice(0, 10).toLowerCase() : null;
}

/**
 * The amount out of an ERC-20 `transfer(address,uint256)`.
 *
 * Null when the calldata is not exactly that shape. Null means "we cannot tell
 * how much this moves", which is a refusal — a call whose value we cannot
 * measure cannot be checked against a spend limit.
 */
export function decodeTransferAmount(data: string): bigint | null {
  // 0x + 8 selector + 64 address + 64 amount
  if (data.length !== 138) return null;
  if (selectorOf(data) !== ERC20_TRANSFER) return null;

  try {
    return BigInt(`0x${data.slice(74, 138)}`);
  } catch {
    return null;
  }
}

/**
 * May this session sign these calls?
 *
 * Checks the whole batch together, because spend limits are cumulative: three
 * transfers that each pass individually can breach the cap in aggregate, and a
 * per-call check would wave all three through.
 */
export function authoriseCalls(
  permissions: SessionPermissions,
  calls: readonly { chainId: ChainId; to: Address; data: string; value: string }[],
  now: Date = new Date(),
): CallAuthorisation {
  if (isSessionExpired(permissions, now)) {
    return {
      ok: false,
      code: 'session_expired',
      message: 'That session has expired. A new one needs your approval.',
    };
  }

  const spent = new Map<Address, bigint>();

  for (const call of calls) {
    if (call.chainId !== permissions.chainId) {
      return {
        ok: false,
        code: 'wrong_chain',
        message: 'This session is not valid on that chain.',
      };
    }

    /*
     * A session key may not move native token. Every action we support is an
     * ERC-20 call, and a non-zero value is either a bug or an attempt to drain
     * gas money through a path that has no spend limit attached.
     */
    if (call.value !== '0') {
      return {
        ok: false,
        code: 'native_value_not_permitted',
        message: 'The agent cannot send ETH.',
      };
    }

    const permitted = permissions.calls.find((entry) => entry.target === call.to.toLowerCase());

    if (!permitted) {
      return {
        ok: false,
        code: 'target_not_permitted',
        message: 'The agent is not allowed to call that contract.',
      };
    }

    const selector = selectorOf(call.data);

    if (!selector || !permitted.selectors.includes(selector)) {
      return {
        ok: false,
        code: 'selector_not_permitted',
        message: 'The agent is not allowed to perform that action on that contract.',
      };
    }

    const limit = permissions.spendLimits.find((entry) => entry.token === call.to.toLowerCase());

    if (limit) {
      const amount = decodeTransferAmount(call.data);

      if (amount === null) {
        return {
          ok: false,
          code: 'undecodable_call',
          message: "We couldn't work out how much that call moves, so it wasn't signed.",
        };
      }

      const running = (spent.get(limit.token) ?? 0n) + amount;

      if (running > limit.limit) {
        return {
          ok: false,
          code: 'over_spend_limit',
          message: "That would exceed this session's spending limit.",
        };
      }

      spent.set(limit.token, running);
    }
  }

  return { ok: true };
}
