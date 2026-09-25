import type { Address, ChainId, Hex, PreparedCall, ResolvedToken } from '@blocky/shared';

/**
 * Calldata construction.
 *
 * This is the only place in the product where transaction bytes are assembled,
 * and every byte of it comes from a validated Intent by way of our own code.
 * Nothing here is ever parsed out of model output.
 *
 * Encoded by hand rather than with a chain library. ERC-20 `transfer` is a
 * selector and two 32-byte words; a dependency to concatenate three strings
 * would be a dependency in the one file where auditability matters most.
 */

/** `transfer(address,uint256)` */
const ERC20_TRANSFER_SELECTOR = 'a9059cbb';

/** `approve(address,uint256)` */
const ERC20_APPROVE_SELECTOR = '095ea7b3';

/** `depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)` — CCTP v2 TokenMessenger. */
const DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR = '779b432d';

/** `depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)` — Across SpokePool. */
const ACROSS_DEPOSIT_V3_SELECTOR = '7b939232';

/** The largest value a uint256 can hold. */
const UINT256_MAX = (1n << 256n) - 1n;

/**
 * Left-pad a value to a 32-byte ABI word.
 *
 * Throws rather than truncating on overflow. A silently wrapped amount is a
 * transfer for the wrong number.
 */
function word(value: bigint): string {
  if (value < 0n) throw new Error('Cannot encode a negative value');
  if (value > UINT256_MAX) throw new Error('Value exceeds uint256');

  return value.toString(16).padStart(64, '0');
}

function addressWord(address: Address): string {
  const bare = address.slice(2).toLowerCase();

  if (!/^[0-9a-f]{40}$/.test(bare)) {
    throw new Error(`Not a 20-byte address: ${address}`);
  }

  return bare.padStart(64, '0');
}

/** Encode an ERC-20 `transfer(to, amount)`. */
export function encodeErc20Transfer(to: Address, amount: bigint): Hex {
  return `0x${ERC20_TRANSFER_SELECTOR}${addressWord(to)}${word(amount)}`;
}

/**
 * The single call behind a token transfer.
 *
 * `value` is zero: this is an ERC-20 movement, not a native one. Blocky's
 * balance is USDC, and a native transfer would be a different code path we do
 * not currently offer.
 */
export function erc20TransferCall(args: {
  chainId: ChainId;
  token: ResolvedToken;
  to: Address;
  amount: bigint;
  displayAmount: string;
  recipientDisplay: string;
}): PreparedCall {
  return {
    chainId: args.chainId,
    to: args.token.address,
    data: encodeErc20Transfer(args.to, args.amount),
    value: '0',
    description: `Transfer ${args.displayAmount} ${args.token.symbol} to ${args.recipientDisplay}`,
  };
}

/** Encode an ERC-20 `approve(spender, amount)`. */
export function encodeErc20Approve(spender: Address, amount: bigint): Hex {
  return `0x${ERC20_APPROVE_SELECTOR}${addressWord(spender)}${word(amount)}`;
}

/**
 * Encode CCTP v2's `depositForBurnWithHook`.
 *
 * Eight arguments, the last a dynamic `bytes`: seven head words, an offset to
 * the hook data (eight words in, 0x100), then its length and its bytes padded
 * to a word boundary. Checked byte-for-byte against viem's encoder in the
 * tests.
 */
export function encodeDepositForBurnWithHook(args: {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: Address;
  burnToken: Address;
  maxFee: bigint;
  minFinalityThreshold: number;
  hookData: Hex;
}): Hex {
  const hook = args.hookData.slice(2).toLowerCase();
  if (!/^([0-9a-f]{2})*$/.test(hook)) throw new Error('Hook data is not whole bytes');

  const padded = hook.padEnd(Math.ceil(hook.length / 64) * 64, '0');

  return `0x${DEPOSIT_FOR_BURN_WITH_HOOK_SELECTOR}${[
    word(args.amount),
    word(BigInt(args.destinationDomain)),
    addressWord(args.mintRecipient),
    addressWord(args.burnToken),
    // destinationCaller: empty, so the Forwarding Service may submit the mint.
    // Anyone who does can only mint to `mintRecipient`.
    word(0n),
    word(args.maxFee),
    word(BigInt(args.minFinalityThreshold)),
    word(8n * 32n),
    word(BigInt(hook.length / 2)),
    padded,
  ].join('')}`;
}

/**
 * The two calls behind moving USDC to another chain, signed together as one
 * operation: allow the messenger exactly the amount being burned, then burn it.
 *
 * The allowance is exact, never unlimited. An open-ended approval left behind
 * on a contract is a standing permission nobody reviews again.
 */
export function cctpBurnCalls(args: {
  chainId: ChainId;
  token: ResolvedToken;
  messenger: Address;
  burn: bigint;
  maxFee: bigint;
  destinationDomain: number;
  recipient: Address;
  hookData: Hex;
  minFinalityThreshold: number;
  displayAmount: string;
  destinationName: string;
}): PreparedCall[] {
  return [
    {
      chainId: args.chainId,
      to: args.token.address,
      data: encodeErc20Approve(args.messenger, args.burn),
      value: '0',
      description: `Allow Circle's CCTP to move ${args.displayAmount} ${args.token.symbol}`,
    },
    {
      chainId: args.chainId,
      to: args.messenger,
      data: encodeDepositForBurnWithHook({
        amount: args.burn,
        destinationDomain: args.destinationDomain,
        mintRecipient: args.recipient,
        burnToken: args.token.address,
        maxFee: args.maxFee,
        minFinalityThreshold: args.minFinalityThreshold,
        hookData: args.hookData,
      }),
      value: '0',
      description: `Move ${args.displayAmount} ${args.token.symbol} to ${args.destinationName}`,
    },
  ];
}

/**
 * Encode Across's `depositV3` with an empty message: twelve arguments, the
 * last an empty `bytes` — eleven head words, its offset (twelve words in,
 * 0x180), and a zero length. Checked byte-for-byte against viem's encoder in
 * the tests.
 */
export function encodeAcrossDepositV3(args: {
  depositor: Address;
  recipient: Address;
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  destinationChainId: number;
  exclusiveRelayer: Address;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
}): Hex {
  return `0x${ACROSS_DEPOSIT_V3_SELECTOR}${[
    addressWord(args.depositor),
    addressWord(args.recipient),
    addressWord(args.inputToken),
    addressWord(args.outputToken),
    word(args.inputAmount),
    word(args.outputAmount),
    word(BigInt(args.destinationChainId)),
    addressWord(args.exclusiveRelayer),
    word(BigInt(args.quoteTimestamp)),
    word(BigInt(args.fillDeadline)),
    word(BigInt(args.exclusivityDeadline)),
    word(12n * 32n),
    word(0n),
  ].join('')}`;
}

/**
 * The two calls behind an Across move, signed together as one transaction:
 * allow the SpokePool exactly the amount deposited, then deposit it, paying
 * out to the user's own wallet on the destination.
 */
export function acrossDepositCalls(args: {
  chainId: ChainId;
  token: ResolvedToken;
  spokePool: Address;
  depositor: Address;
  outputToken: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  destinationChainId: number;
  exclusiveRelayer: Address;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
  displayAmount: string;
  destinationName: string;
}): PreparedCall[] {
  return [
    {
      chainId: args.chainId,
      to: args.token.address,
      data: encodeErc20Approve(args.spokePool, args.inputAmount),
      value: '0',
      description: `Allow Across to move ${args.displayAmount} ${args.token.symbol}`,
    },
    {
      chainId: args.chainId,
      to: args.spokePool,
      data: encodeAcrossDepositV3({
        depositor: args.depositor,
        recipient: args.depositor,
        inputToken: args.token.address,
        outputToken: args.outputToken,
        inputAmount: args.inputAmount,
        outputAmount: args.outputAmount,
        destinationChainId: args.destinationChainId,
        exclusiveRelayer: args.exclusiveRelayer,
        quoteTimestamp: args.quoteTimestamp,
        fillDeadline: args.fillDeadline,
        exclusivityDeadline: args.exclusivityDeadline,
      }),
      value: '0',
      description: `Move ${args.displayAmount} ${args.token.symbol} to ${args.destinationName} through Across`,
    },
  ];
}
