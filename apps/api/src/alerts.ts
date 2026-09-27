import { displayUsd, formatUsd, parseUsd } from '@blocky/shared';
import type { Store } from './store';

/**
 * Price alerts: "tell me if ETH drops under $2,500". Checked once a minute
 * against the same shared price snapshot everything else reads, so a thousand
 * alerts cost one price request, not a thousand. Each fires once — a
 * notification in the user's inbox — and is then done.
 */

export const ALERT_CHECK_MS = 60_000;

/** A symbol's price as a USD decimal string, or null when there isn't a trustworthy one. */
export type PriceLookup = (symbol: string) => Promise<string | null>;

export async function checkPriceAlerts(store: Store, priceOf: PriceLookup): Promise<number> {
  const alerts = await store.listOpenPriceAlerts();
  if (alerts.length === 0) return 0;

  const prices = new Map<string, string | null>();
  for (const symbol of new Set(alerts.map((alert) => alert.symbol))) {
    prices.set(symbol, await priceOf(symbol).catch(() => null));
  }

  let fired = 0;
  for (const alert of alerts) {
    const price = prices.get(alert.symbol);
    if (!price) continue;

    const now = parseUsd(price);
    const line = parseUsd(alert.thresholdUsd);
    const crossed = alert.direction === 'above' ? now >= line : now <= line;
    if (!crossed) continue;

    await store.markPriceAlertTriggered(alert.id);
    await store.notify(alert.userId, {
      kind: 'price_alert',
      title: `${alert.symbol} is ${alert.direction === 'above' ? 'above' : 'below'} ${displayUsd(alert.thresholdUsd)}`,
      body: `It's at ${displayUsd(formatUsd(now))} now.`,
      data: { symbol: alert.symbol, priceUsd: formatUsd(now) },
    });
    fired += 1;
  }
  return fired;
}
