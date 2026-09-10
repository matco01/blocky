import { AddressSchema } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { rpcConfigFromEnv } from '../src';

/**
 * The checksum trap.
 *
 * viem returns EIP-55 checksummed addresses. Everything else in the product
 * compares addresses lowercased, because `AddressSchema` normalises them. An
 * address that arrives from a chain read without being normalised is a
 * different string to `isKnownRecipient`, so a recipient the user explicitly
 * allowlisted reads as a stranger and can never auto-execute.
 */
describe('address normalisation', () => {
  it('AddressSchema lowercases, which is the rule chain reads must match', () => {
    const checksummed = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    expect(AddressSchema.parse(checksummed)).toBe(checksummed.toLowerCase());
  });

  it('a checksummed address does not equal its lowercase form', () => {
    // The reason this is a bug and not a cosmetic detail.
    const checksummed = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    expect(checksummed).not.toBe(checksummed.toLowerCase());
    expect([checksummed.toLowerCase()].includes(checksummed)).toBe(false);
  });
});

describe('rpcConfigFromEnv', () => {
  it('configures nothing when nothing is set', () => {
    expect(rpcConfigFromEnv({}).urls).toEqual({});
  });

  it('wires Base Sepolia and Ethereum independently', () => {
    const config = rpcConfigFromEnv({
      BASE_SEPOLIA_RPC_URL: 'https://base.example',
      ETHEREUM_RPC_URL: 'https://eth.example',
    });

    expect(config.urls[84532]).toBe('https://base.example');
    // Ethereum is present for ENS only — we never transact there.
    expect(config.urls[1]).toBe('https://eth.example');
  });

  it('leaves Ethereum unset when only Base is configured, so ENS degrades quietly', () => {
    const config = rpcConfigFromEnv({ BASE_SEPOLIA_RPC_URL: 'https://base.example' });

    expect(config.urls[1]).toBeUndefined();
  });
});
