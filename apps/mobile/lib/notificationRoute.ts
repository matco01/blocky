import type { Href } from 'expo-router';

/**
 * Where a notification leads when it's tapped — a push on the lock screen or
 * a row in the inbox: money that arrived opens Activity on that payment;
 * anything else opens the inbox, where a request can be paid.
 */
export function routeFor(data: Record<string, unknown> | undefined): Href {
  const kind = typeof data?.kind === 'string' ? data.kind : null;
  const txHash = typeof data?.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(data.txHash) ? data.txHash : null;
  if ((kind === 'money_received' || kind === 'request_paid') && txHash) {
    return { pathname: '/activity', params: { tx: txHash } };
  }
  return '/notifications';
}
