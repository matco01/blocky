import { CHAIN, type Address } from '@blocky/shared';
import { encodeAbiParameters, encodeEventTopics, pad, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  FUNDS_DEPOSITED_TOPIC,
  acrossSpokePool,
  containsAcrossDeposit,
  fetchAcrossQuote,
  type ExpectedDeposit,
  type Receipt,
} from '../src';

const ME = '0x2222222222222222222222222222222222222222' as Address;
const OTHER = '0x3333333333333333333333333333333333333333' as Address;
const SPOKE = acrossSpokePool(CHAIN.arc)!;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address;
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address;

describe('fetching a quote', () => {
  const good = {
    spokePoolAddress: '0x9b4A302A548c7e313c2b74C461db7b84d3074A84',
    outputAmount: '19994305',
    exclusiveRelayer: '0x0000000000000000000000000000000000000000',
    timestamp: '1790355671',
    fillDeadline: '1790362871',
    exclusivityDeadline: 0,
    estimatedFillTimeSec: 2,
    isAmountTooLow: false,
    limits: { maxDeposit: '664222482694' },
  };

  function fakeFetch(status: number, body: unknown) {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { impl, calls };
  }

  const args = { from: CHAIN.arc, to: CHAIN.base, inputAmount: 20_000_000n, recipient: ME } as const;

  it('asks for USDC to USDC between the right chains, for the exact amount, to the user', async () => {
    const { impl, calls } = fakeFetch(200, good);

    await fetchAcrossQuote(args, impl);

    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/api/suggested-fees');
    expect(url.searchParams.get('inputToken')).toBe(ARC_USDC);
    expect(url.searchParams.get('outputToken')).toBe(BASE_USDC);
    expect(url.searchParams.get('originChainId')).toBe('5042');
    expect(url.searchParams.get('destinationChainId')).toBe('8453');
    expect(url.searchParams.get('amount')).toBe('20000000');
    expect(url.searchParams.get('recipient')).toBe(ME);
  });

  it('turns a quote into exact numbers', async () => {
    const quote = await fetchAcrossQuote(args, fakeFetch(200, good).impl);

    expect(quote).toMatchObject({
      spokePool: SPOKE,
      outputAmount: 19_994_305n,
      quoteTimestamp: 1_790_355_671,
      fillDeadline: 1_790_362_871,
      etaSeconds: 2,
    });
  });

  /** The API supplies prices. Which contract the money goes to is ours to decide. */
  it('refuses a quote naming a SpokePool we did not pin', async () => {
    const { impl } = fakeFetch(200, { ...good, spokePoolAddress: OTHER });

    await expect(fetchAcrossQuote(args, impl)).rejects.toThrow(/SpokePool/);
  });

  it('refuses a quote that pays out more than goes in', async () => {
    await expect(fetchAcrossQuote(args, fakeFetch(200, { ...good, outputAmount: '20000001' }).impl)).rejects.toThrow();
  });

  it('is "no route", not an error, for an amount too small or too large', async () => {
    expect(await fetchAcrossQuote(args, fakeFetch(200, { ...good, isAmountTooLow: true }).impl)).toBeNull();
    expect(await fetchAcrossQuote(args, fakeFetch(200, { ...good, limits: { maxDeposit: '1' } }).impl)).toBeNull();
    expect(await fetchAcrossQuote(args, fakeFetch(400, { message: 'Unsupported route' }).impl)).toBeNull();
  });

  it('throws when Across itself is down', async () => {
    await expect(fetchAcrossQuote(args, fakeFetch(503, {}).impl)).rejects.toThrow(/503/);
  });

  it('has no route from a chain without a SpokePool, and asks nobody', async () => {
    const { impl, calls } = fakeFetch(200, good);

    expect(await fetchAcrossQuote({ ...args, from: CHAIN.arcTestnet, to: CHAIN.baseSepolia }, impl)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('verifying a deposit in a receipt', () => {
  const EVENT = parseAbi([
    'event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)',
  ]);

  /** A log built by viem's encoder, so our hand decoding is checked against an independent one. */
  function depositLog(
    over: Partial<{ depositor: Address; recipient: Address; inputAmount: bigint; outputAmount: bigint; destination: number; outputToken: Address; emitter: Address }> = {},
  ) {
    const topics = encodeEventTopics({
      abi: EVENT,
      eventName: 'FundsDeposited',
      args: { destinationChainId: BigInt(over.destination ?? CHAIN.base), depositId: 7n, depositor: pad(over.depositor ?? ME, { size: 32 }) },
    });
    const data = encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint32' },
        { type: 'uint32' },
        { type: 'uint32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes' },
      ],
      [
        pad(ARC_USDC, { size: 32 }),
        pad(over.outputToken ?? BASE_USDC, { size: 32 }),
        over.inputAmount ?? 20_000_000n,
        over.outputAmount ?? 19_994_305n,
        1_790_355_671,
        1_790_362_871,
        0,
        pad(over.recipient ?? ME, { size: 32 }),
        pad('0x', { size: 32 }),
        '0x',
      ],
    );
    return { address: over.emitter ?? SPOKE, topics: topics as string[], data };
  }

  const expected: ExpectedDeposit = {
    spokePool: SPOKE,
    inputToken: ARC_USDC,
    outputToken: BASE_USDC,
    inputAmount: 20_000_000n,
    outputAmount: 19_994_305n,
    destinationChainId: CHAIN.base,
    depositor: ME,
    recipient: ME,
  };

  const receipt = (log = depositLog(), status: Receipt['status'] = 'success'): Receipt => ({ status, logs: [log] });

  it('uses the event topic viem computes', () => {
    expect(depositLog().topics[0]).toBe(FUNDS_DEPOSITED_TOPIC);
  });

  it('accepts exactly the planned deposit', () => {
    expect(containsAcrossDeposit(receipt(), expected)).toBe(true);
  });

  it.each([
    ['paying out to someone else', { recipient: OTHER }],
    ['made from someone else’s wallet', { depositor: OTHER }],
    ['to a different chain', { destination: CHAIN.arbitrum }],
    ['of a different amount', { inputAmount: 1n }],
    ['paying out less than quoted', { outputAmount: 19_000_000n }],
    ['paying out a different token', { outputToken: OTHER }],
    ['emitted by a contract that is not the pinned SpokePool', { emitter: OTHER }],
  ])('rejects a deposit %s', (_, over) => {
    expect(containsAcrossDeposit(receipt(depositLog(over)), expected)).toBe(false);
  });

  it('rejects a reverted transaction', () => {
    expect(containsAcrossDeposit(receipt(depositLog(), 'reverted'), expected)).toBe(false);
  });
});
