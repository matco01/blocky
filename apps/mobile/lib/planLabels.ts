import { displayUsd, parseUsd, type Plan } from '@blocky/shared';

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
