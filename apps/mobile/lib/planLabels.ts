import { displayUsd, parseUsd, type Plan } from '@blocky/shared';
import { getChain } from '@blocky/wallet-core';

/** What a plan sends, as the user would say it: "$25.00", or "12.5 EURC" when unpriced. */
export function planAmountLabel(plan: Plan): string {
  const outflow = plan.outflow[0];
  if (!outflow) return '';
  return outflow.usdValue ? displayUsd(outflow.usdValue) : `${outflow.displayAmount} ${outflow.token.symbol}`;
}

/** The fee as one number in dollars, or "Free". */
export function planFeeLabel(plan: Plan): string {
  return parseUsd(plan.fee.totalUsd) === 0n ? 'Free' : displayUsd(plan.fee.totalUsd);
}

/**
 * What the fee line is called. A move between chains quotes a ceiling —
 * whatever Circle doesn't use arrives with the money — so it says so.
 */
export function planFeeName(plan: Plan): string {
  return plan.intentType === 'bridge' ? 'Fees, at most' : 'Network fee';
}

/** "Send" pays someone; "Move" is the user's own money changing chains. */
export function planVerb(plan: Plan): 'Send' | 'Move' {
  return plan.intentType === 'bridge' ? 'Move' : 'Send';
}

/** Where it goes, finishing "… to ___": a person, or the user's own wallet on another chain. */
export function planDestinationLabel(plan: Plan): string {
  if (plan.recipient) return plan.recipient.display;

  const landing = plan.inflow[0];
  if (plan.intentType === 'bridge' && landing) return `your wallet on ${getChain(landing.token.chainId).name}`;

  return 'yourself';
}
