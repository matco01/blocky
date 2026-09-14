import { CHAIN } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { fetchGatewayBalances } from '../src';

const DEPOSITOR = '0x1111111111111111111111111111111111111111' as const;

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];

  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

  return { impl, calls };
}

describe('Gateway balances', () => {
  it('asks for every verified testnet domain, and nothing unverified', async () => {
    const { impl, calls } = fakeFetch(200, { balances: [] });

    await fetchGatewayBalances(DEPOSITOR, { testnet: true, fetch: impl });

    const sources = (calls[0]?.body as { sources: Array<{ domain: number }> }).sources;
    // Arc 26, Base Sepolia 6, Arbitrum Sepolia 3 — the domains we verified.
    expect(sources.map((s) => s.domain).sort((a, b) => a - b)).toEqual([3, 6, 26]);
    expect(calls[0]?.url).toBe('https://gateway-api-testnet.circle.com/v1/balances');
  });

  it('sums exactly, using the response shape observed on the live API', async () => {
    const { impl } = fakeFetch(200, {
      token: 'USDC',
      balances: [
        { domain: 26, depositor: DEPOSITOR, balance: '0.852485', pendingBatch: '0' },
        { domain: 6, depositor: DEPOSITOR, balance: '1.010001', pendingBatch: '0.5' },
      ],
    });

    const result = await fetchGatewayBalances(DEPOSITOR, { testnet: true, fetch: impl });

    expect(result.totalUsd).toBe('1.862486');
    expect(result.perChain).toContainEqual({
      chainId: CHAIN.baseSepolia,
      domain: 6,
      balanceUsd: '1.010001',
      pendingUsd: '0.5',
    });
  });

  it('throws on an API failure rather than reporting zero', async () => {
    const { impl } = fakeFetch(503, { error: 'down' });

    await expect(fetchGatewayBalances(DEPOSITOR, { testnet: true, fetch: impl })).rejects.toThrow(
      /503/,
    );
  });

  it('throws on a malformed balance rather than coercing it', async () => {
    const { impl } = fakeFetch(200, { balances: [{ domain: 26, balance: '1e6' }] });

    await expect(fetchGatewayBalances(DEPOSITOR, { testnet: true, fetch: impl })).rejects.toThrow();
  });

  it('skips domains it does not recognise', async () => {
    const { impl } = fakeFetch(200, { balances: [{ domain: 999, balance: '5' }] });

    const result = await fetchGatewayBalances(DEPOSITOR, { testnet: true, fetch: impl });

    expect(result).toEqual({ totalUsd: '0', perChain: [] });
  });
});
