import { CHAIN, type Address } from '@blocky/shared';
import { encodeAbiParameters, encodeFunctionData, pad, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { NATIVE_TOKEN, acrossSpokePool, acrossSwapHandler, fetchAcrossSwapQuote } from '../src';

/**
 * A swap quote is the one place a third party writes part of what the user
 * signs: the instructions Across's handler runs on the destination. These
 * tests build quotes the way Across does and tamper with one thing at a time —
 * every tampering must be refused.
 */

const ME = '0x578c01d4e7e70fbc61d12b72cf52009914b91d2d' as Address;
const THIEF = '0x3333333333333333333333333333333333333333' as Address;
const SPOKE = acrossSpokePool(CHAIN.arc)!;
const HANDLER = acrossSwapHandler(CHAIN.hyperevm)!;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address;
const HYPER_USDC = '0xb88339cb7199b77e23db6e890353e22632ba630f' as Address;
const DEX = '0x0a0758d937d1059c356d4714e57f5df0239bce1a' as Address;

const DEPOSIT = parseAbi([
  'function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
]);
const HANDLER_ABI = parseAbi(['function drainLeftoverTokens(address token, address destination)']);
const ERC20 = parseAbi(['function approve(address,uint256)']);

const drain = (token: Address, to: Address, target: Address = HANDLER) => ({
  target,
  callData: encodeFunctionData({ abi: HANDLER_ABI, functionName: 'drainLeftoverTokens', args: [token, to] }),
  value: 0n,
});

interface Tamper {
  depositor?: Address;
  recipient?: Address;
  inputToken?: Address;
  inputAmount?: bigint;
  destination?: number;
  fallbackRecipient?: Address;
  calls?: Array<{ target: Address; callData: `0x${string}`; value: bigint }>;
  to?: Address;
  min?: string;
}

function swapResponse(t: Tamper = {}) {
  const calls = t.calls ?? [
    { target: HYPER_USDC, callData: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [DEX, 19_988_045n] }), value: 0n },
    { target: DEX, callData: '0x4666fc80' as const, value: 0n },
    drain(NATIVE_TOKEN, ME),
    drain(HYPER_USDC, ME),
  ];

  const message = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'callData', type: 'bytes' }, { name: 'value', type: 'uint256' }] },
          { name: 'fallbackRecipient', type: 'address' },
        ],
      },
    ],
    [{ calls, fallbackRecipient: t.fallbackRecipient ?? ME }],
  );

  const data = encodeFunctionData({
    abi: DEPOSIT,
    functionName: 'deposit',
    args: [
      pad(t.depositor ?? ME, { size: 32 }),
      pad(t.recipient ?? HANDLER, { size: 32 }),
      pad(t.inputToken ?? ARC_USDC, { size: 32 }),
      pad(HYPER_USDC, { size: 32 }),
      t.inputAmount ?? 20_000_000n,
      19_988_045n,
      BigInt(t.destination ?? CHAIN.hyperevm),
      pad('0x', { size: 32 }),
      1_790_354_073,
      1_790_364_563,
      0,
      message,
    ],
  });

  return {
    swapTx: { to: t.to ?? SPOKE, chainId: 5042, data },
    expectedOutputAmount: '218835012168116965',
    minOutputAmount: t.min ?? '207893261559711117',
    expectedFillTime: 2,
  };
}

const fetchWith = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

const args = { from: CHAIN.arc, to: CHAIN.hyperevm, inputAmount: 20_000_000n, outputToken: NATIVE_TOKEN, recipient: ME } as const;

describe('a well-formed swap quote', () => {
  it('passes, with the expected and minimum amounts', async () => {
    const quote = await fetchAcrossSwapQuote(args, fetchWith(swapResponse()));

    expect(quote).toMatchObject({
      spokePool: SPOKE,
      inputAmount: 20_000_000n,
      outputToken: NATIVE_TOKEN,
      expectedOut: 218_835_012_168_116_965n,
      minOut: 207_893_261_559_711_117n,
      etaSeconds: 2,
    });
  });

  it('is "no route" when Across has none', async () => {
    expect(await fetchAcrossSwapQuote(args, fetchWith({ message: 'no route' }, 400))).toBeNull();
  });

  it('never asks about a chain without a pinned handler', async () => {
    expect(await fetchAcrossSwapQuote({ ...args, to: CHAIN.arcTestnet }, fetchWith(swapResponse()))).toBeNull();
  });
});

describe('a tampered swap quote is refused', () => {
  it.each<[string, Tamper]>([
    ['sent to a contract that is not the pinned SpokePool', { to: THIEF }],
    ['depositing from someone else', { depositor: THIEF }],
    ['depositing something other than Arc USDC', { inputToken: THIEF }],
    ['depositing a different amount', { inputAmount: 30_000_000n }],
    ['going to a different chain', { destination: CHAIN.base }],
    ['bridging to anyone but the pinned handler', { recipient: THIEF }],
    ['refunding a failed swap to someone else', { fallbackRecipient: THIEF }],
    ['paying the swapped token out to someone else', { calls: [drain(NATIVE_TOKEN, THIEF)] }],
    ['paying leftovers out to someone else', { calls: [drain(NATIVE_TOKEN, ME), drain(HYPER_USDC, THIEF)] }],
    ['paying out through a contract that is not the handler', { calls: [drain(NATIVE_TOKEN, ME, THIEF)] }],
    ['never paying out the token asked for', { calls: [drain(HYPER_USDC, ME)] }],
    ['promising a minimum above the expected amount', { min: '999999999999999999999' }],
  ])('%s', async (_, tamper) => {
    await expect(fetchAcrossSwapQuote(args, fetchWith(swapResponse(tamper)))).rejects.toThrow(/refused/);
  });
});
