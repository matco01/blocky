import { describe, expect, it } from 'vitest';
import { routeFor } from './notificationRoute';

const TX = `0x${'ab'.repeat(32)}`;

describe('where a tapped notification leads', () => {
  it('opens Activity on the payment, for money that arrived', () => {
    expect(routeFor({ kind: 'money_received', txHash: TX })).toEqual({ pathname: '/activity', params: { tx: TX } });
    expect(routeFor({ kind: 'request_paid', requestId: 'r1', txHash: TX })).toEqual({ pathname: '/activity', params: { tx: TX } });
  });

  it('opens the inbox for everything else — a request is paid from there', () => {
    expect(routeFor({ kind: 'request_received', requestId: 'r1' })).toBe('/notifications');
    expect(routeFor({ kind: 'price_alert' })).toBe('/notifications');
    expect(routeFor(undefined)).toBe('/notifications');
  });

  it('never routes on a payload that isn’t what the server sends', () => {
    expect(routeFor({ kind: 'money_received', txHash: 'javascript:alert(1)' })).toBe('/notifications');
    expect(routeFor({ kind: 'money_received', txHash: 42 })).toBe('/notifications');
  });
});
