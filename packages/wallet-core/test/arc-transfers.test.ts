import { CHAIN, type Address } from '@blocky/shared';
import { InvalidParamsRpcError, LimitExceededRpcError, RpcRequestError, UnknownRpcError } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  ARC_TRANSFER_EMITTER,
  TRANSFER_TOPIC,
  decodeUsdcTransfer,
  isRangeRefusal,
  readUsdcTransfers,
  type ChainLog,
  type ChainReader,
  type LogFilter,
} from '../src';

/**
 * Reading Arc's money movements straight from the chain. The two ways to get
 * this wrong are both about counting: missing native sends, or counting a
 * token transfer twice. Shapes below are copied from live testnet and
 * mainnet receipts.
 */

const ALICE = '0x578c01d4e7e70fbc61d12b72cf52009914b91d2d' as Address;
const BOB = '0xd4c0b787aa2ff9eb751bb515c877ebbf2daddaae' as Address;
const TOKEN = '0x3600000000000000000000000000000000000000' as Address;
const AT = new Date('2026-10-17T12:00:00Z');

const topic = (address: string) => `0x${address.slice(2).padStart(64, '0')}` as `0x${string}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as `0x${string}`;

function log(over: Partial<ChainLog> & { from?: Address; to?: Address; value?: bigint } = {}): ChainLog {
  const { from = BOB, to = ALICE, value = 2n * 10n ** 18n, ...rest } = over;
  return {
    address: ARC_TRANSFER_EMITTER,
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: word(value),
    blockNumber: 100,
    blockTimestamp: AT,
    transactionHash: `0x${'a'.repeat(64)}`,
    logIndex: 0,
    ...rest,
  };
}

/** A reader whose `getLogs` is whatever the test needs; nothing else is called. */
function readerWith(getLogs: (filter: LogFilter) => ChainLog[] | Promise<ChainLog[]>, blockTime?: (n: number) => Date): ChainReader {
  return {
    getLogs: async (_chainId: number, filter: LogFilter) => getLogs(filter),
    blockTime: async (_chainId: number, n: number) => (blockTime ? blockTime(n) : AT),
  } as unknown as ChainReader;
}

describe('decodeUsdcTransfer', () => {
  it('reads the system Transfer at 18 decimals as dollars at 6', () => {
    // A $2 ERC-20 send on testnet: 2e18 on the system log.
    const transfer = decodeUsdcTransfer(log(), AT);

    expect(transfer).toMatchObject({ from: BOB, to: ALICE, amount: 2_000_000n, blockNumber: 100, logIndex: 0 });
  });

  it('rounds down: a fraction of a cent that never arrived is not shown', () => {
    // A live mainnet native send of 3226637965293 wei — $0.000003226…
    expect(decodeUsdcTransfer(log({ value: 3_226_637_965_293n }), AT)?.amount).toBe(3n);
  });

  it('ignores the token contract’s own copy, so a token transfer counts once', () => {
    expect(decodeUsdcTransfer(log({ address: TOKEN, data: word(2_000_000n) }), AT)).toBeNull();
  });

  it('ignores any other event from the system address', () => {
    expect(decodeUsdcTransfer(log({ topics: [`0x${'b'.repeat(64)}`, topic(BOB), topic(ALICE)] }), AT)).toBeNull();
  });

  it('lowercases what the node sent', () => {
    const transfer = decodeUsdcTransfer(log({ transactionHash: `0x${'A'.repeat(64)}` as `0x${string}` }), AT);
    expect(transfer?.txHash).toBe(`0x${'a'.repeat(64)}`);
  });
});

describe('readUsdcTransfers', () => {
  it('asks the system address for Transfers, and only to the wallets when told to', async () => {
    const asked: LogFilter[] = [];
    const reader = readerWith((filter) => {
      asked.push(filter);
      return [log()];
    });

    await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 10, to: 20 });
    await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 10, to: 20 }, { side: 'to', wallets: [ALICE] });
    await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 10, to: 20 }, { side: 'from', wallets: [ALICE] });

    expect(asked.map((filter) => filter.address)).toEqual([ARC_TRANSFER_EMITTER, ARC_TRANSFER_EMITTER, ARC_TRANSFER_EMITTER]);
    expect(asked[0]!.topics).toEqual([TRANSFER_TOPIC]);
    expect(asked[1]!.topics).toEqual([TRANSFER_TOPIC, null, [topic(ALICE)]]);
    expect(asked[2]!.topics).toEqual([TRANSFER_TOPIC, [topic(ALICE)]]);
    expect(asked[0]).toMatchObject({ fromBlock: 10, toBlock: 20 });
  });

  it('asks nothing for an empty range or no wallets', async () => {
    let calls = 0;
    const reader = readerWith(() => {
      calls++;
      return [];
    });

    expect(await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 21, to: 20 })).toEqual([]);
    expect(await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 1, to: 20 }, { side: 'to', wallets: [] })).toEqual([]);
    expect(calls).toBe(0);
  });

  it('halves a range the endpoint refuses, covering every block exactly once', async () => {
    const covered: number[] = [];
    const reader = readerWith((filter) => {
      if (filter.toBlock - filter.fromBlock + 1 > 300) {
        throw new UnknownRpcError(new RpcRequestError({ body: {}, url: 'https://rpc.example', error: { code: -32012, message: 'requested range too large' } }));
      }
      for (let n = filter.fromBlock; n <= filter.toBlock; n++) covered.push(n);
      return [log({ blockNumber: filter.fromBlock })];
    });

    const transfers = await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 1, to: 1000 });

    expect(covered).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
    // In block order: the halves come back first, then second.
    expect(transfers.map((t) => t.blockNumber)).toEqual([...transfers.map((t) => t.blockNumber)].sort((a, b) => a - b));
  });

  it('does not split on a rate limit: the same range is tried again later', async () => {
    let calls = 0;
    const reader = readerWith(() => {
      calls++;
      throw new LimitExceededRpcError(new RpcRequestError({ body: {}, url: 'https://rpc.example', error: { code: -32005, message: 'rate limit exceeded' } }));
    });

    await expect(readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 1, to: 1000 })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('reads the block time when a node leaves it off the log — once per block', async () => {
    const asked: number[] = [];
    const reader = readerWith(
      () => [log({ blockTimestamp: null, logIndex: 0 }), log({ blockTimestamp: null, logIndex: 1 })],
      (n) => {
        asked.push(n);
        return new Date('2026-10-01T00:00:00Z');
      },
    );

    const transfers = await readUsdcTransfers(reader, CHAIN.arcTestnet, { from: 100, to: 100 });

    expect(asked).toEqual([100]);
    expect(transfers.map((t) => t.at.toISOString())).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
  });
});

describe('isRangeRefusal', () => {
  const rpcError = (code: number, message: string, url = 'https://rpc.example') =>
    new RpcRequestError({ body: { method: 'eth_getLogs' }, url, error: { code, message } });

  it('recognises each way providers say a query is too big', () => {
    // Arc's public endpoint, both of its node types, word for word.
    expect(isRangeRefusal(new UnknownRpcError(rpcError(-32012, 'requested range too large')))).toBe(true);
    expect(
      isRangeRefusal(
        new InvalidParamsRpcError(rpcError(-32602, 'request exceeded max allowed range: query exceeds max results 2000, retry with the range 67682997-67683855')),
      ),
    ).toBe(true);
    // Infura and Alchemy.
    expect(isRangeRefusal(new LimitExceededRpcError(rpcError(-32005, 'query returned more than 10000 results')))).toBe(true);
    expect(isRangeRefusal(rpcError(-32602, 'Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range'))).toBe(true);
  });

  it('a rate limit is not a refusal, whatever code it comes with', () => {
    expect(isRangeRefusal(new LimitExceededRpcError(rpcError(-32005, 'rate limit exceeded')))).toBe(false);
    expect(isRangeRefusal(new Error('429 Too Many Requests'))).toBe(false);
  });

  it('reads the node’s words, not the URL or request around them', () => {
    // viem's full message carries the endpoint URL; a provider path that happens to say "range" is not a refusal.
    expect(isRangeRefusal(rpcError(-32000, 'execution timeout', 'https://range.example/v2/key'))).toBe(false);
  });
});
