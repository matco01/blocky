import { NATIVE_TOKEN, getChain } from '@blocky/wallet-core';
import { formatUsd, parseUsd, type Plan } from '@blocky/shared';

/**
 * Where the money went: "how much did I spend this month?"
 *
 * Built from what Blocky recorded — every send, move, buy and sale the user
 * approved, with the plan behind it — so each one lands in a category without
 * guessing from a counterparty address. Built to take card spending later:
 * a card payment is just another category.
 *
 * Moves between the user's own wallets aren't spending, and neither is buying
 * something they still own — but the fees on either are, and are counted.
 */

export type Category = 'people' | 'investing' | 'moves' | 'sales';

/** The categories a budget can be set on. `total` is people and investing together. */
export const BUDGET_CATEGORIES = ['people', 'investing', 'total'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export interface RecordedMove {
  plan: Plan;
  /** ISO time it was recorded. */
  at: string;
}

export interface Received {
  from: string;
  usd: string;
  at: string;
}

export interface MonthInsights {
  /** "2026-09". */
  month: string;
  /** Sent to people plus invested — what left the wallet on purpose. */
  spentUsd: string;
  byCategory: Record<'people' | 'investing', string>;
  /** Network, route and Blocky fees on everything this month. */
  feesUsd: string;
  /** Paid in by other Blocky users. */
  receivedUsd: string;
  /** Sold back to dollars. */
  soldUsd: string;
  topPeople: Array<{ name: string; usd: string }>;
  /** Spent last month, for comparison — null when there's nothing to compare. */
  lastMonthSpentUsd: string | null;
  count: number;
}

/** Which category a recorded move belongs to. */
export function categorise(plan: Plan): Category {
  if (plan.intentType === 'transfer') {
    return plan.recipient?.display === 'your own wallet' ? 'moves' : 'people';
  }
  const bought = plan.inflow[0]?.token;
  const sold = plan.outflow[0]?.token;
  if (sold && !isDollar(sold)) return 'sales';
  if (bought && !isDollar(bought)) return 'investing';
  return 'moves';
}

function isDollar(token: Plan['inflow'][number]['token']): boolean {
  const chain = getChain(token.chainId);
  return token.address === chain.usdc || (chain.gasPaidInUsdc && token.address === NATIVE_TOKEN);
}

/** "2026-09" for a date. */
export function monthOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
}

/** What a move put into its category, in USD units: the main outflow, fees apart. */
function movedUnits(plan: Plan): bigint {
  const main = plan.outflow[0]?.usdValue;
  return main ? parseUsd(main) : 0n;
}

export function monthInsights(month: string, moves: readonly RecordedMove[], received: readonly Received[]): MonthInsights {
  const inMonth = moves.filter((move) => monthOf(move.at) === month);
  const spentLast = spentUnits(moves.filter((move) => monthOf(move.at) === previousMonth(month)));

  const people = new Map<string, bigint>();
  let peopleUnits = 0n;
  let investingUnits = 0n;
  let soldUnits = 0n;
  let feeUnits = 0n;

  for (const { plan } of inMonth) {
    feeUnits += parseUsd(plan.fee.totalUsd);
    const units = movedUnits(plan);
    switch (categorise(plan)) {
      case 'people': {
        peopleUnits += units;
        const name = plan.recipient?.display ?? 'someone';
        people.set(name, (people.get(name) ?? 0n) + units);
        break;
      }
      case 'investing':
        investingUnits += units;
        break;
      case 'sales':
        soldUnits += plan.inflow[0]?.usdValue ? parseUsd(plan.inflow[0].usdValue) : 0n;
        break;
      case 'moves':
        break;
    }
  }

  const receivedUnits = received.filter((r) => monthOf(r.at) === month).reduce((sum, r) => sum + parseUsd(r.usd), 0n);

  return {
    month,
    spentUsd: formatUsd(peopleUnits + investingUnits),
    byCategory: { people: formatUsd(peopleUnits), investing: formatUsd(investingUnits) },
    feesUsd: formatUsd(feeUnits),
    receivedUsd: formatUsd(receivedUnits),
    soldUsd: formatUsd(soldUnits),
    topPeople: [...people.entries()]
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .slice(0, 5)
      .map(([name, units]) => ({ name, usd: formatUsd(units) })),
    lastMonthSpentUsd: spentLast > 0n ? formatUsd(spentLast) : null,
    count: inMonth.length,
  };
}

function spentUnits(moves: readonly RecordedMove[]): bigint {
  return moves.reduce((sum, { plan }) => {
    const category = categorise(plan);
    return category === 'people' || category === 'investing' ? sum + movedUnits(plan) : sum;
  }, 0n);
}

/** Spent this month in a budget's category, in USD units. */
export function spentInCategory(insights: MonthInsights, category: BudgetCategory): bigint {
  if (category === 'total') return parseUsd(insights.spentUsd);
  return parseUsd(insights.byCategory[category]);
}

/**
 * The budget alerts a move just crossed: 80% and 100%, each said once, at the
 * move that crossed it.
 */
export function crossedBudgetLines(limitUnits: bigint, beforeUnits: bigint, afterUnits: bigint): Array<80 | 100> {
  if (limitUnits <= 0n) return [];
  const lines: Array<80 | 100> = [];
  for (const pct of [80, 100] as const) {
    const line = (limitUnits * BigInt(pct)) / 100n;
    if (beforeUnits < line && afterUnits >= line) lines.push(pct);
  }
  return lines;
}

/** A month's moves as CSV: one row each, what a spreadsheet or an accountant wants. */
export function statementCsv(month: string, moves: readonly RecordedMove[]): string {
  const rows = moves
    .filter((move) => monthOf(move.at) === month)
    .map(({ plan, at }) => {
      const out = plan.outflow[0];
      const inn = plan.inflow[0];
      return [
        at,
        categorise(plan),
        plan.summary,
        out ? `${out.displayAmount} ${out.token.symbol}` : '',
        out?.usdValue ?? '',
        inn ? `${inn.displayAmount} ${inn.token.symbol}` : '',
        plan.fee.totalUsd,
      ];
    });
  const header = ['date', 'category', 'description', 'sent', 'sent_usd', 'received', 'fees_usd'];
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
