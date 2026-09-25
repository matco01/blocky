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
 * What the fee line is called. Some routes between chains quote a ceiling —
 * whatever they don't use arrives with the money — and those say so.
 */
export function planFeeName(plan: Plan): string {
  if (plan.intentType !== 'bridge') return 'Network fee';
  return plan.route?.feeIsCeiling ? 'Fees, at most' : 'Fees';
}

/**
 * For a move between chains: what lands and how soon — "$19.99 on Base, in
 * about 2 seconds". "At least" where the fee is a ceiling. Null otherwise.
 */
export function planArrivalLabel(plan: Plan): string | null {
  const landing = plan.inflow[0];
  if (plan.intentType !== 'bridge' || !landing) return null;

  const amount = landing.usdValue ? displayUsd(landing.usdValue) : `${landing.displayAmount} ${landing.token.symbol}`;
  const where = getChain(landing.token.chainId).name;
  const when = plan.route ? `, in ${describeEta(plan.route.etaSeconds)}` : '';

  return `${plan.route?.feeIsCeiling ? 'At least ' : ''}${amount} on ${where}${when}`;
}

function describeEta(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
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
