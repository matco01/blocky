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
