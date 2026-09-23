import { CHAIN, type Address } from '@blocky/shared';
import { encodeAbiParameters, encodeEventTopics, pad, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  CCTP_FORWARD_HOOK_DATA,
  canMoveUsdcBetween,
  cctpArrivalForBurn,
  cctpBurnForArrival,
  cctpContracts,
  containsCctpBurn,
  fetchCctpFees,
  type ExpectedBurn,
  type Receipt,
} from '../src';

const ME = '0x2222222222222222222222222222222222222222' as Address;
const OTHER = '0x3333333333333333333333333333333333333333' as Address;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address;
const MESSENGER = cctpContracts(CHAIN.arcTestnet)!.tokenMessenger;

describe('which chains CCTP connects', () => {
  it('connects Arc testnet to the other testnets we list', () => {
    expect(canMoveUsdcBetween(CHAIN.arcTestnet, CHAIN.baseSepolia)).toBe(true);
    expect(canMoveUsdcBetween(CHAIN.arcTestnet, CHAIN.arbitrumSepolia)).toBe(true);
  });

  it('never connects testnet to mainnet', () => {
    expect(canMoveUsdcBetween(CHAIN.arcTestnet, CHAIN.base)).toBe(false);
  });

  it('has no mainnet contracts until they are verified', () => {
    expect(cctpContracts(CHAIN.base)).toBeNull();
  });

  it('does not move money to where it already is', () => {
    expect(canMoveUsdcBetween(CHAIN.arcTestnet, CHAIN.arcTestnet)).toBe(false);
  });
});

describe('fetching fees', () => {
  const response = [
    { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 54233, med: 54433, high: 54565 } },
    { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1, med: 2, high: 3 } },
  ];

  function fakeFetch(status: number, body: unknown) {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { impl, calls };
  }

  it('asks Circle for a forwarded Fast Transfer between the right domains', async () => {
    const { impl, calls } = fakeFetch(200, response);

    await fetchCctpFees(CHAIN.arcTestnet, CHAIN.baseSepolia, impl);

    expect(calls[0]).toBe('https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/6?forward=true');
  });

  /** A ceiling set too low is not cheaper — Circle skips the mint and the money waits. */
  it('uses the high forwarding estimate, and the Fast Transfer protocol fee', async () => {
    const { impl } = fakeFetch(200, response);

    expect(await fetchCctpFees(CHAIN.arcTestnet, CHAIN.baseSepolia, impl)).toEqual({
      forwardFee: 54565n,
      protocolFeeCentiBps: 130n,
    });
  });

  it('treats a missing forwarding fee as unavailable, never as free', async () => {
    const { impl } = fakeFetch(200, [{ finalityThreshold: 1000, minimumFee: 0 }]);

    await expect(fetchCctpFees(CHAIN.arcTestnet, CHAIN.baseSepolia, impl)).rejects.toThrow();
  });

  it('throws on an API failure', async () => {
    const { impl } = fakeFetch(503, {});

    await expect(fetchCctpFees(CHAIN.arcTestnet, CHAIN.baseSepolia, impl)).rejects.toThrow(/503/);
  });

  it('refuses a pair it cannot connect, without calling anyone', async () => {
    const { impl, calls } = fakeFetch(200, response);

    await expect(fetchCctpFees(CHAIN.arcTestnet, CHAIN.base, impl)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('fee arithmetic', () => {
  const fees = { forwardFee: 54_565n, protocolFeeCentiBps: 130n }; // 1.3 bps

  /** What Circle takes, at most: the forward fee plus the protocol fee on the whole burn. */
  const charged = (burn: bigint) => fees.forwardFee + (burn * fees.protocolFeeCentiBps + 999_999n) / 1_000_000n;

  it('burns enough that the full amount still arrives after every fee', () => {
    for (const arrive of [1n, 999n, 20_000_000n, 123_456_789n, 10_000_000_000_000n]) {
      const { burn, maxFee } = cctpBurnForArrival(arrive, fees);

      expect(burn).toBe(arrive + maxFee);
      expect(burn - charged(burn)).toBeGreaterThanOrEqual(arrive);
    }
  });

  it('with no protocol fee, the ceiling is exactly the forwarding fee', () => {
    expect(cctpBurnForArrival(20_000_000n, { forwardFee: 54_565n, protocolFeeCentiBps: 0n })).toEqual({
      burn: 20_054_565n,
      maxFee: 54_565n,
    });
  });

  it('for "everything", delivers what is left after the fees', () => {
    const result = cctpArrivalForBurn(20_000_000n, fees)!;

    expect(result.arrive + result.maxFee).toBe(20_000_000n);
    expect(result.maxFee).toBeGreaterThanOrEqual(charged(20_000_000n));
  });

  it('says so when the fees would take all of it', () => {
    expect(cctpArrivalForBurn(50_000n, fees)).toBeNull();
  });

  it('refuses to move nothing', () => {
    expect(() => cctpBurnForArrival(0n, fees)).toThrow();
  });
});

describe('verifying a burn in a receipt', () => {
  const EVENT = parseAbi([
    'event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)',
  ]);

  /** A log built by viem's encoder, so our hand decoding is checked against an independent one. */
  function burnLog(args: {
    depositor?: Address;
    amount?: bigint;
    mintRecipient?: Address;
    destinationDomain?: number;
    maxFee?: bigint;
    emitter?: Address;
  } = {}) {
    const topics = encodeEventTopics({
      abi: EVENT,
      eventName: 'DepositForBurn',
      args: { burnToken: ARC_USDC, depositor: args.depositor ?? ME, minFinalityThreshold: 1000 },
    });

    const data = encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes' },
      ],
      [
        args.amount ?? 20_054_565n,
        pad(args.mintRecipient ?? ME, { size: 32 }),
        args.destinationDomain ?? 6,
        pad(MESSENGER, { size: 32 }),
        pad('0x', { size: 32 }),
        args.maxFee ?? 54_565n,
        CCTP_FORWARD_HOOK_DATA,
      ],
    );

    return { address: args.emitter ?? MESSENGER, topics: topics as string[], data };
  }

  const expected: ExpectedBurn = {
    messenger: MESSENGER,
    burnToken: ARC_USDC,
    depositor: ME,
    amount: 20_054_565n,
    mintRecipient: ME,
    destinationDomain: 6,
    maxFee: 54_565n,
  };

  const receipt = (log = burnLog(), status: Receipt['status'] = 'success'): Receipt => ({ status, logs: [log] });

  it('accepts exactly the planned burn', () => {
    expect(containsCctpBurn(receipt(), expected)).toBe(true);
  });

  it('accepts a burn that allowed less fee than the user agreed to', () => {
    expect(containsCctpBurn(receipt(burnLog({ maxFee: 1n })), expected)).toBe(true);
  });

  it.each([
    ['to a different recipient', { mintRecipient: OTHER }],
    ['to a different chain', { destinationDomain: 3 }],
    ['of a different amount', { amount: 1n }],
    ['from someone else', { depositor: OTHER }],
    ['with a higher fee ceiling than agreed', { maxFee: 54_566n }],
    ['emitted by a contract that is not the messenger', { emitter: OTHER }],
  ])('rejects a burn %s', (_, override) => {
    expect(containsCctpBurn(receipt(burnLog(override)), expected)).toBe(false);
  });

  it('rejects a reverted transaction', () => {
    expect(containsCctpBurn(receipt(burnLog(), 'reverted'), expected)).toBe(false);
  });
});
