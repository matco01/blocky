import { describe, expect, it } from 'vitest';
import { getArcProtocols } from '../src';

function fakeFetch(status: number, body: unknown) {
  const impl = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  return impl;
}

const MORPHO = {
  name: 'Morpho Blue',
  category: 'Lending',
  chains: ['Ethereum', 'Arc', 'Base'],
  chainTvls: { Ethereum: 5_000_000_000, Arc: 184_000_000, 'Arc-borrowed': 9_700_000 },
  tvl: 10_700_000_000,
};

const UNISWAP = {
  name: 'Uniswap V3',
  category: 'Dexs',
  chains: ['Ethereum', 'Arc'],
  chainTvls: { Ethereum: 900_000_000, Arc: 16_800_000 },
  tvl: 1_600_000_000,
};

const ETH_ONLY = {
  name: 'Some Ethereum Thing',
  category: 'Dexs',
  chains: ['Ethereum'],
  chainTvls: { Ethereum: 1_000_000 },
  tvl: 1_000_000,
};

describe('Arc protocol list', () => {
  it('keeps only protocols actually live on Arc', async () => {
    const protocols = await getArcProtocols(fakeFetch(200, [MORPHO, UNISWAP, ETH_ONLY]));

    expect(protocols.map((p) => p.name)).toEqual(['Morpho Blue', 'Uniswap V3']);
  });

  it('ranks by Arc-specific TVL, never the protocol-wide total', async () => {
    const protocols = await getArcProtocols(fakeFetch(200, [UNISWAP, MORPHO]));

    // Uniswap's global tvl is bigger than Morpho's Arc tvl, but on Arc Morpho leads.
    expect(protocols[0]?.name).toBe('Morpho Blue');
    expect(protocols[0]?.tvlUsd).toBe(184_000_000);
    expect(protocols[1]?.tvlUsd).toBe(16_800_000);
  });

  it('ignores the "-borrowed" sub-metric rather than folding it into TVL', async () => {
    const protocols = await getArcProtocols(fakeFetch(200, [MORPHO]));

    expect(protocols[0]?.tvlUsd).toBe(184_000_000);
  });

  it('caps the list rather than handing back everything DefiLlama tracks', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Protocol ${i}`,
      category: 'Other',
      chains: ['Arc'],
      chainTvls: { Arc: i },
    }));

    expect((await getArcProtocols(fakeFetch(200, many))).length).toBeLessThanOrEqual(15);
  });

  it('throws on an actual API failure', async () => {
    await expect(getArcProtocols(fakeFetch(503, {}))).rejects.toThrow(/503/);
  });
});
