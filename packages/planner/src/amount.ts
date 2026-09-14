import {
  formatUnits,
  parseUnits,
  tokenAmountForUsd,
  usdValueOf,
  type AmountSpec,
  type AssetDelta,
  type ResolvedToken,
} from '@blocky/shared';

/**
 * Turning "twenty bucks" into an exact quantity.
 *
 * Pure, and bigint throughout. The one rule that matters here is that we never
 * round in the user's disfavour and never silently truncate — `parseUnits`
 * throws on excess precision rather than dropping digits, and this module does
 * not catch that.
 */

export type AmountResult =
  | { ok: true; amount: bigint }
  | { ok: false; reason: 'unpriced' | 'invalid' | 'insufficient' };

export interface AmountInput {
  spec: AmountSpec;
  token: ResolvedToken;
  /** USD price of one whole token, or null when unknown. */
  unitPrice: string | null;
  /** Spendable balance in base units. */
  balance: bigint;
  /**
   * Fee that must stay behind, when the fee is paid in the token being sent.
   *
   * Applies to every kind of amount. For `max` it is subtracted from the
   * balance; for a fixed amount, amount plus reserve must fit in the balance. A
   * USDC send whose gas comes out of the same USDC has to leave room for it, or
   * the transaction fails at execution having looked fine on the confirmation
   * card.
   */
  reserve?: bigint;
}

export function resolveAmount({
  spec,
  token,
  unitPrice,
  balance,
  reserve = 0n,
}: AmountInput): AmountResult {
  const spendable = balance - reserve;

  switch (spec.kind) {
    case 'token': {
      try {
        return checked(parseUnits(spec.value, token.decimals), spendable);
      } catch {
        return { ok: false, reason: 'invalid' };
      }
    }

    case 'usd': {
      // An unpriced token cannot be converted. We do not fall back to treating
      // the number as token units — "$20 of a token worth $0.0001" and "20 of
      // that token" differ by five orders of magnitude.
      if (unitPrice === null) return { ok: false, reason: 'unpriced' };

      try {
        return checked(tokenAmountForUsd(spec.value, token.decimals, unitPrice), spendable);
      } catch {
        return { ok: false, reason: 'invalid' };
      }
    }

    case 'max': {
      // Reserving the fee can take the whole balance. That is "you cannot
      // afford to move this", not "send zero".
      if (spendable <= 0n) return { ok: false, reason: 'insufficient' };

      return { ok: true, amount: spendable };
    }
  }
}

function checked(amount: bigint, spendable: bigint): AmountResult {
  if (amount <= 0n) return { ok: false, reason: 'invalid' };
  if (amount > spendable) return { ok: false, reason: 'insufficient' };

  return { ok: true, amount };
}

/**
 * Build the display form of a quantity.
 *
 * `amount` stays the source of truth; `displayAmount` and `usdValue` are
 * derived and never read back into arithmetic.
 */
export function assetDelta(
  token: ResolvedToken,
  amount: bigint,
  unitPrice: string | null,
): AssetDelta {
  return {
    token,
    amount: amount.toString(),
    displayAmount: formatUnits(amount, token.decimals),
    usdValue: unitPrice === null ? null : formatUsdValue(amount, token, unitPrice),
  };
}

function formatUsdValue(amount: bigint, token: ResolvedToken, unitPrice: string): string {
  return formatUnits(usdValueOf(amount, token.decimals, unitPrice), 6);
}
