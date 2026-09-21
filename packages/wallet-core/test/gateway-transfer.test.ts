import { CHAIN, type Address, type Hex } from '@blocky/shared';
import { hashTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  BURN_INTENT_DOMAIN,
  BURN_INTENT_TYPES,
  buildBurnIntent,
  burnIntentTypedData,
  fetchGatewayInfo,
  requestGatewayTransfer,
  usdcAddress,
  type GatewayDomainInfo,
} from '../src';

/**
 * Burn intents are the one thing here a user signs blind: the wallet shows a
 * typed-data blob, not a sentence. So these tests pin the exact structure —
 * field order included — because a reordered struct hashes differently, and a
 * different hash means signing something other than what the card said.
 */

const ARC: GatewayDomainInfo = {
  domain: 26,
  chain: 'Arc',
  network: 'Testnet',
  walletContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  minterContract: '0x0022222abe238cc2c7bb1f21003f0a260052475b',
  burnIntentExpirationHeight: 64_516_257n,
};

const BASE: GatewayDomainInfo = { ...ARC, domain: 6, chain: 'Base', network: 'Sepolia' };

const DEPOSITOR = '0x1111111111111111111111111111111111111111' as Address;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as Address;
const SALT = `0x${'ab'.repeat(32)}` as Hex;

function intent(over: Partial<Parameters<typeof buildBurnIntent>[0]> = {}) {
  return buildBurnIntent({
    source: ARC,
    destination: BASE,
    sourceUsdc: usdcAddress(CHAIN.arcTestnet),
    destinationUsdc: usdcAddress(CHAIN.baseSepolia),
    depositor: DEPOSITOR,
    recipient: RECIPIENT,
    value: 20_000_000n,
    maxFee: 2_010_000n,
    salt: SALT,
    ...over,
  });
}

describe('the spec Circle signs', () => {
  it('pads every address into bytes32', () => {
    const spec = intent().spec;

    expect(spec.sourceDepositor).toBe(`0x${'0'.repeat(24)}${DEPOSITOR.slice(2)}`);
    expect(spec.destinationRecipient).toBe(`0x${'0'.repeat(24)}${RECIPIENT.slice(2)}`);
    expect(spec.sourceDepositor).toHaveLength(66);
  });

  it('burns from the source wallet contract and mints via the destination minter', () => {
    const spec = intent().spec;

    expect(spec.sourceContract).toContain(ARC.walletContract.slice(2));
    expect(spec.destinationContract).toContain(BASE.minterContract.slice(2));
  });

  it('signs as the depositor', () => {
    // A signer that is not the depositor is a different account's money.
    expect(intent().spec.sourceSigner).toBe(intent().spec.sourceDepositor);
  });

  it('defaults the destination caller to the recipient, never the zero address', () => {
    // Zero would let anyone submit the attestation and pick the moment it lands.
    expect(intent().spec.destinationCaller).toBe(intent().spec.destinationRecipient);
    expect(intent().spec.destinationCaller).not.toBe(`0x${'0'.repeat(64)}`);
  });

  it('bounds the intent to the domain expiry rather than leaving it valid forever', () => {
    // maxUint256 would mean a signature lifted off a device months later still mints.
    expect(intent().maxBlockHeight).toBe(ARC.burnIntentExpirationHeight);
    expect(intent().maxBlockHeight).toBeLessThan(2n ** 256n - 1n);
  });

  it('keeps USDC at 6 decimals even though Arc gas is 18', () => {
    expect(intent({ value: 20_000_000n }).spec.value).toBe(20_000_000n);
  });
});

describe('the EIP-712 payload', () => {
  it('produces a digest an independent implementation can compute', () => {
    const typed = burnIntentTypedData(intent());

    expect(typed.domain).toEqual(BURN_INTENT_DOMAIN);
    expect(typed.primaryType).toBe('BurnIntent');
    expect(hashTypedData(typed)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes the digest when the amount changes', () => {
    const a = hashTypedData(burnIntentTypedData(intent({ value: 20_000_000n })));
    const b = hashTypedData(burnIntentTypedData(intent({ value: 20_000_001n })));

    expect(a).not.toBe(b);
  });

  it('changes the digest when the recipient changes', () => {
    const a = hashTypedData(burnIntentTypedData(intent()));
    const b = hashTypedData(
      burnIntentTypedData(intent({ recipient: '0x3333333333333333333333333333333333333333' })),
    );

    expect(a).not.toBe(b);
  });

  it('declares the struct fields in the documented order', () => {
    expect(BURN_INTENT_TYPES.BurnIntent.map((f) => f.name)).toEqual([
      'maxBlockHeight',
      'maxFee',
      'spec',
    ]);
    expect(BURN_INTENT_TYPES.TransferSpec.map((f) => f.name)).toEqual([
      'version',
      'sourceDomain',
      'destinationDomain',
      'sourceContract',
      'destinationContract',
      'sourceToken',
      'destinationToken',
      'sourceDepositor',
      'destinationRecipient',
      'sourceSigner',
      'destinationCaller',
      'value',
      'salt',
      'hookData',
    ]);
  });
});

describe('talking to Gateway', () => {
  it('sends bigints as strings, since JSON has none', async () => {
    let body: string | undefined;

    await requestGatewayTransfer(
      { burnIntent: intent(), signature: '0xdead' as Hex },
      {
        testnet: true,
        fetch: (async (_url: string, init: RequestInit) => {
          body = init.body as string;
          return {
            ok: true,
            json: async () => ({ attestation: '0xaa', signature: '0xbb' }),
          } as Response;
        }) as unknown as typeof fetch,
      },
    );

    const parsed = JSON.parse(body ?? '[]');
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].burnIntent.spec.value).toBe('20000000');
    expect(parsed[0].burnIntent.maxFee).toBe('2010000');
  });

  it('refuses a response with no attestation rather than returning a blank one', async () => {
    await expect(
      requestGatewayTransfer(
        { burnIntent: intent(), signature: '0xdead' as Hex },
        {
          testnet: true,
          fetch: (async () =>
            ({ ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/no attestation/i);
  });

  it('skips non-EVM domains when reading Gateway info', async () => {
    const domains = await fetchGatewayInfo({
      testnet: true,
      fetch: (async () =>
        ({
          ok: true,
          json: async () => ({
            domains: [
              {
                domain: 26,
                chain: 'Arc',
                network: 'Testnet',
                walletContract: { address: ARC.walletContract },
                minterContract: { address: ARC.minterContract },
                burnIntentExpirationHeight: '64516257',
              },
              // Solana is in this list too, with base58 addresses.
              {
                domain: 5,
                chain: 'Solana',
                network: 'Devnet',
                walletContract: { address: 'GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu' },
                minterContract: { address: 'GATEmKK2ECL1brEngQZWCgMWPbvrEYqsV6u29dAaHavr' },
              },
            ],
          }),
        }) as Response) as unknown as typeof fetch,
    });

    expect(domains).toHaveLength(1);
    expect(domains[0]?.domain).toBe(26);
    expect(domains[0]?.burnIntentExpirationHeight).toBe(64_516_257n);
  });
});
