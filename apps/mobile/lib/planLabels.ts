import { displayUsd, formatUnits, parseUsd, type Plan } from '@blocky/shared';
import { DEFAULT_CHAIN, NATIVE_TOKEN, getChain, stockByAddress } from '@blocky/wallet-core';

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
 * Blocky's own share of the fee, said plainly — "$0.10 (0.5%)" — or null when
 * the plan charges none (every plain send, and every move home).
 */
export function planBlockyFeeLabel(plan: Plan): string | null {
  if (!plan.blockyFee) return null;
  return `${displayUsd(plan.blockyFee.usd)} (${plan.blockyFee.bps / 100}%)`;
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

  const where = getChain(landing.token.chainId).name;
  const when = plan.route ? `, in ${describeEta(plan.route.etaSeconds)}` : '';

  if (isSwap(plan)) {
    const minimum = plan.route?.minimumReceived
      ? ` (at least ${shortAmount(formatUnits(BigInt(plan.route.minimumReceived), landing.token.decimals))})`
      : '';
    return `About ${shortAmount(landing.displayAmount)} ${landing.token.symbol}${minimum} on ${where}${when}`;
  }

  const amount = landing.usdValue ? displayUsd(landing.usdValue) : `${landing.displayAmount} ${landing.token.symbol}`;
  return `${plan.route?.feeIsCeiling ? 'At least ' : ''}${amount} on ${where}${when}`;
}

/** "+ $0.25 of ETH for fees there", when a gas top-up rides along. */
export function planGasTopUpLabel(plan: Plan): string | null {
  const paid = plan.outflow[1];
  const gas = plan.inflow[1];
  if (!plan.route?.gasTopUp || !paid || !gas) return null;
  return `+ ${displayUsd(paid.usdValue ?? '0')} of ${gas.token.symbol} for fees there`;
}

/**
 * Why the top-up is there, said before the user approves — nothing leaves
 * their wallet unexplained, least of all on a small balance: "Robinhood Chain
 * charges its fees in ETH, and you have none there. This covers selling it
 * later; whatever isn't used stays yours."
 */
export function planGasTopUpReason(plan: Plan): string | null {
  const gas = plan.inflow[1];
  if (!planGasTopUpLabel(plan) || !gas) return null;
  const chain = getChain(gas.token.chainId).name;
  const later = planVerb(plan) === 'Buy' ? 'selling it later' : 'moving it again later';
  return `${chain} charges its fees in ${gas.token.symbol}, and you have none there. This covers ${later}; whatever isn't used stays yours.`;
}

/** A token amount trimmed for reading: a few significant digits, never a wall of decimals. */
function shortAmount(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  if (whole !== '0') return fraction ? `${whole}.${fraction.slice(0, Math.max(0, 6 - whole.length))}`.replace(/\.?0+$/, '') : whole;
  const firstSignificant = fraction.search(/[1-9]/);
  if (firstSignificant === -1) return '0';
  return `0.${fraction.slice(0, firstSignificant + 4)}`.replace(/0+$/, '');
}

function describeEta(seconds: number): string {
  if (seconds < 1.5) return 'about a second';
  if (seconds < 60) return `about ${Math.round(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

/** A move between chains that arrives as a different token — USDC in, ETH out. */
function isSwap(plan: Plan): boolean {
  const landing = plan.inflow[0]?.token;
  return plan.intentType === 'bridge' && landing !== undefined && (landing.address === NATIVE_TOKEN || isAsset(landing));
}

/** A token bought or sold as a thing in itself — a stock, a memecoin — not dollars or gas. */
function isAsset(token: Plan['inflow'][number]['token'] | undefined): boolean {
  return token !== undefined && token.address !== NATIVE_TOKEN && token.address !== getChain(token.chainId).usdc;
}

/** How a person names it: the company for a stock, the symbol for anything else. */
function assetName(token: Plan['inflow'][number]['token']): string {
  return stockByAddress(token.chainId, token.address)?.name ?? token.symbol;
}

/**
 * "Send" pays someone; "Move" is the user's own money changing chains; "Swap"
 * changes what it is, too; "Buy" and "Sell" are stocks, said the way people
 * say them.
 */
export function planVerb(plan: Plan): 'Send' | 'Move' | 'Swap' | 'Buy' | 'Sell' {
  if (plan.intentType !== 'bridge') return 'Send';
  if (isAsset(plan.inflow[0]?.token)) return 'Buy';
  // Off Arc only: Arc has no assets to sell but its USDC.
  const sold = plan.outflow[0]?.token;
  if (sold && sold.chainId !== DEFAULT_CHAIN && isAsset(sold)) return 'Sell';
  return isSwap(plan) ? 'Swap' : 'Move';
}

/** What a plan buys or sells, by name — "Apple", "PEPE" — or null. */
export function planStockName(plan: Plan): string | null {
  const bought = plan.inflow[0]?.token;
  if (bought && isAsset(bought)) return assetName(bought);
  const sold = plan.outflow[0]?.token;
  return sold && isAsset(sold) ? assetName(sold) : null;
}

/**
 * The line under the amount, finishing "You're sending $20 ___": "to Sam",
 * "to your wallet on Base" — or, for stocks, "of Apple" and "for USDC on Arc".
 */
export function planDestinationLabel(plan: Plan): string {
  if (plan.recipient) {
    // Off Arc, where it lands matters: the recipient receives it on that chain.
    const chainId = plan.calls[0]?.chainId;
    const where = chainId !== undefined && chainId !== DEFAULT_CHAIN ? ` on ${getChain(chainId).name}` : '';
    return `to ${plan.recipient.display}${where}`;
  }

  const verb = planVerb(plan);
  if (verb === 'Buy') return `of ${planStockName(plan) ?? 'stocks'}`;
  if (verb === 'Sell') return `for USDC on ${getChain(plan.inflow[0]!.token.chainId).name}`;

  const landing = plan.inflow[0];
  if (plan.intentType === 'bridge' && landing) return `to your wallet on ${getChain(landing.token.chainId).name}`;

  return 'to yourself';
}
