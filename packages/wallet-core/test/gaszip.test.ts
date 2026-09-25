import { CHAIN, type Address } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import {
  encodeGasZipDeposit,
  fetchGasZipQuote,
  gasZipDepositContract,
  gasZipShortId,
  isGasZipDeposit,
} from '../src';

const WALLET = '0x578c01d4e7e70fbc61d12b72cf52009914b91d2d' as Address;
const CONTRACT = gasZipDepositContract(CHAIN.arc)!;

describe('the deposit calldata', () => {
  /** Byte-for-byte what Gas.zip's own API built for this wallet, to Base and to Unichain. */
  it('matches the deposit Gas.zip itself builds', () => {
    expect(encodeGasZipDeposit(54, WALLET)).toBe(
      '0xc9630cb00000000000000000000000000000000000000000000000000000000000000036578c01d4e7e70fbc61d12b72cf52009914b91d2d000000000000000000000000',
    );
    expect(encodeGasZipDeposit(362, WALLET).slice(0, 74)).toBe(
      '0xc9630cb0000000000000000000000000000000000000000000000000000000000000016a',
    );
  });

  it('knows the short ids of the chains it delivers to', () => {
    expect(gasZipShortId(CHAIN.base)).toBe(54);
    expect(gasZipShortId(CHAIN.ethereum)).toBe(255);
    expect(gasZipShortId(CHAIN.arc)).toBeNull();
  });
});

describe('fetching a quote', () => {
  const good = {
    contractDepositTxn: { to: '0x9E22ebeC84c7e4C4bD6D4aE7FF6f4D436D6D8390' },
    quotes: [{ chain: 8453, decimals: 18, expected: 742884241241434, speed: 2.0 }],
  };

  function fakeFetch(status: number, body: unknown) {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { impl, calls };
  }

  const args = { from: CHAIN.arc, to: CHAIN.base, inputAmount: 2_000_000n, recipient: WALLET } as const;

  it('asks for the deposit in native units — 18 decimals on Arc', async () => {
    const { impl, calls } = fakeFetch(200, good);

    await fetchGasZipQuote(args, impl);

    expect(calls[0]).toBe(`https://backend.gas.zip/v2/quotes/5042/2000000000000000000/8453?from=${WALLET}&to=${WALLET}`);
  });

  it('returns exact numbers, with the value the deposit carries', async () => {
    expect(await fetchGasZipQuote(args, fakeFetch(200, good).impl)).toEqual({
      contract: CONTRACT,
      shortId: 54,
      inputAmount: 2_000_000n,
      value: 2_000_000_000_000_000_000n,
      expectedOut: 742_884_241_241_434n,
      outDecimals: 18,
      etaSeconds: 2,
    });
  });

  it('refuses a quote naming another deposit contract', async () => {
    const { impl } = fakeFetch(200, { ...good, contractDepositTxn: { to: '0x3333333333333333333333333333333333333333' } });

    await expect(fetchGasZipQuote(args, impl)).rejects.toThrow(/deposit contract/);
  });

  it('is "no route" for no liquidity or an amount over the limit', async () => {
    const noLiquidity = { error: 'Quote: Please Try Again', quotes: [{ chain: 999, error: 'Quote: Insufficent Liquidity' }] };

    expect(await fetchGasZipQuote(args, fakeFetch(500, noLiquidity).impl)).toBeNull();
    expect(await fetchGasZipQuote(args, fakeFetch(200, { ...good, quotes: [{ chain: 8453, error: 'Quote: Chain Limit Exceeded' }] }).impl)).toBeNull();
  });

  it('only deposits from a chain whose native token is the USDC being sent', async () => {
    const { impl, calls } = fakeFetch(200, good);

    expect(await fetchGasZipQuote({ ...args, from: CHAIN.base, to: CHAIN.arbitrum }, impl)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('verifying a deposit', () => {
  const data = encodeGasZipDeposit(54, WALLET);
  const expected = { from: WALLET, contract: CONTRACT, value: 2_000_000_000_000_000_000n, data };
  const tx = { from: WALLET, to: CONTRACT, value: 2_000_000_000_000_000_000n, input: data };

  it('accepts exactly the planned deposit', () => {
    expect(isGasZipDeposit(tx, 'success', expected)).toBe(true);
  });

  it.each([
    ['from someone else', { from: '0x3333333333333333333333333333333333333333' }],
    ['to another contract', { to: '0x3333333333333333333333333333333333333333' }],
    ['carrying a different amount', { value: 1n }],
    ['delivering somewhere else', { input: encodeGasZipDeposit(255, WALLET) }],
    ['paying out to someone else', { input: encodeGasZipDeposit(54, '0x3333333333333333333333333333333333333333') }],
  ])('rejects a deposit %s', (_, over) => {
    expect(isGasZipDeposit({ ...tx, ...over }, 'success', expected)).toBe(false);
  });

  it('rejects a deposit that reverted', () => {
    expect(isGasZipDeposit(tx, 'reverted', expected)).toBe(false);
  });
});
