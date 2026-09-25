import { CHAIN, type Address } from '@blocky/shared';
import { encodeAbiParameters, encodeFunctionData, pad, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { NATIVE_TOKEN, acrossPeriphery, acrossSpokePool, acrossSwapHandler, fetchAcrossNativeSwapQuote } from '../src';

/**
 * Bringing money home: selling ETH on Arbitrum for USDC on Arc through
 * Across's Periphery. Quotes are built the way Across builds them, then
 * tampered with one field at a time — every tampering must be refused.
 */

const ME = '0x578c01d4e7e70fbc61d12b72cf52009914b91d2d' as Address;
const THIEF = '0x3333333333333333333333333333333333333333' as Address;
const PERIPHERY = acrossPeriphery(CHAIN.arbitrum)!;
const SPOKE = acrossSpokePool(CHAIN.arbitrum)!;
const ARC_HANDLER = acrossSwapHandler(CHAIN.arc)!;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address;
const WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' as Address;
const INPUT = 5_000_000_000_000_000n;

const ABI = parseAbi([
  'function swapAndBridge(((uint256 amount, address recipient) submissionFees, (address inputToken, bytes32 outputToken, uint256 outputAmount, address depositor, bytes32 recipient, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) depositData, address swapToken, address exchange, uint8 transferType, uint256 swapTokenAmount, uint256 minExpectedInputTokenAmount, bytes routerCalldata, bool enableProportionalAdjustment, address spokePool, uint256 nonce) swapAndDepositData) payable',
]);
const HANDLER = parseAbi(['function drainLeftoverTokens(address token, address destination)']);
const ERC20 = parseAbi(['function transfer(address,uint256)']);

type Call = { target: Address; callData: `0x${string}`; value: bigint };
const drain = (to: Address = ME, target: Address = ARC_HANDLER): Call => ({
  target,
  callData: encodeFunctionData({ abi: HANDLER, functionName: 'drainLeftoverTokens', args: [ARC_USDC, to] }),
  value: 0n,
});

function instructions(calls: Call[], fallbackRecipient: Address = NATIVE_TOKEN) {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'calls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'callData', type: 'bytes' }, { name: 'value', type: 'uint256' }] },
          { name: 'fallbackRecipient', type: 'address' },
        ],
      },
    ],
    [{ calls, fallbackRecipient }],
  );
}

interface Tamper {
  to?: Address;
  value?: bigint;
  spokePool?: Address;
  swapAmount?: bigint;
  fee?: bigint;
  depositor?: Address;
  recipient?: Address;
  outputToken?: Address;
  destination?: number;
  message?: `0x${string}`;
}

function response(t: Tamper = {}) {
  const data = encodeFunctionData({
    abi: ABI,
    functionName: 'swapAndBridge',
    args: [
      {
        submissionFees: { amount: t.fee ?? 0n, recipient: NATIVE_TOKEN },
        depositData: {
          inputToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
          outputToken: pad(t.outputToken ?? ARC_USDC, { size: 32 }),
          outputAmount: 13_400_000n,
          depositor: t.depositor ?? ME,
          recipient: pad(t.recipient ?? ARC_HANDLER, { size: 32 }),
          destinationChainId: BigInt(t.destination ?? CHAIN.arc),
          exclusiveRelayer: pad('0x', { size: 32 }),
          quoteTimestamp: 1,
          fillDeadline: 2,
          exclusivityParameter: 0,
          message: t.message ?? instructions([drain(), drain(), { target: '0x446fe2be6a8d90fa89f30f3d0a686aaffe621237', callData: '0xd836083e', value: 0n }]),
        },
        swapToken: WETH,
        exchange: '0x0000000000001ff3684f28c67538d4d072c22734',
        transferType: 1,
        swapTokenAmount: t.swapAmount ?? INPUT,
        minExpectedInputTokenAmount: 13_386_712n,
        routerCalldata: '0x2213bc0b',
        enableProportionalAdjustment: true,
        spokePool: t.spokePool ?? SPOKE,
        nonce: 0n,
      },
    ],
  });

  return {
    swapTx: { to: t.to ?? PERIPHERY, chainId: CHAIN.arbitrum, data, value: String(t.value ?? INPUT) },
    expectedOutputAmount: '13469925',
    minOutputAmount: '13369653',
    expectedFillTime: 0,
  };
}

const fetchWith = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

const args = { from: CHAIN.arbitrum, to: CHAIN.arc, inputAmount: INPUT, recipient: ME } as const;

describe('a well-formed quote', () => {
  it('passes through the handler, when every payout goes to the user', async () => {
    expect(await fetchAcrossNativeSwapQuote(args, fetchWith(response()))).toMatchObject({
      periphery: PERIPHERY,
      inputAmount: INPUT,
      outputToken: ARC_USDC,
      expectedOut: 13_469_925n,
      minOut: 13_369_653n,
    });
  });

  it('passes straight to the user, with no instructions at all', async () => {
    expect(await fetchAcrossNativeSwapQuote(args, fetchWith(response({ recipient: ME, message: '0x' })))).not.toBeNull();
  });

  it('has no route from Arc — its native token is the USDC itself', async () => {
    expect(await fetchAcrossNativeSwapQuote({ ...args, from: CHAIN.arc, to: CHAIN.base }, fetchWith(response()))).toBeNull();
  });
});

describe('a tampered quote is refused', () => {
  it.each<[string, Tamper]>([
    ['sent to a contract that is not the pinned Periphery', { to: THIEF }],
    ['carrying a different value than it sells', { value: INPUT + 1n }],
    ['selling a different amount', { swapAmount: INPUT - 1n }],
    ['depositing through another SpokePool', { spokePool: THIEF }],
    ['paying a submission fee', { fee: 1n }],
    ['depositing for someone else', { depositor: THIEF }],
    ['paying out straight to someone else', { recipient: THIEF, message: '0x' }],
    ['arriving as another token', { outputToken: THIEF }],
    ['going to another chain', { destination: CHAIN.base }],
    ['sending straight to the user with instructions attached', { recipient: ME }],
    ['draining to someone else through the handler', { message: instructions([drain(THIEF)]) }],
    ['draining through a contract that is not the handler', { message: instructions([drain(ME, THIEF)]) }],
    ['refunding to someone else', { message: instructions([drain()], THIEF) }],
    ['never paying the user out', { message: instructions([]) }],
    [
      'slipping in a transfer',
      { message: instructions([drain(), { target: ARC_USDC, callData: encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [THIEF, 1n] }), value: 0n }]) },
    ],
    ['slipping in a call that carries value', { message: instructions([drain(), { target: THIEF, callData: '0x', value: 1n }]) }],
  ])('%s', async (_, tamper) => {
    await expect(fetchAcrossNativeSwapQuote(args, fetchWith(response(tamper)))).rejects.toThrow(/refused/);
  });
});
