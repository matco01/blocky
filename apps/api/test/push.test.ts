import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '../src/db/client';
import { createExpoPush, withPush, type PushMessage, type PushService } from '../src/push';
import { createStore, type Store } from '../src/store';

/**
 * Push: every notification Blocky stores reaches the user's phones once, and
 * phones the app is gone from stop being sent to. Expo itself is faked — the
 * fake answers the way Expo's API documents.
 */

const ALICE = 'did:privy:alice';
const PHONE = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TABLET = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

let database: Database;
let store: Store;

beforeAll(async () => {
  database = await openDatabase({});
  store = createStore(database.db);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.execute(sql`TRUNCATE users CASCADE`);
  await store.upsertUser({ id: ALICE, walletAddress: '0xa11ce00000000000000000000000000000000001' });
});

describe('withPush', () => {
  let sent: PushMessage[][];
  const fake: PushService = {
    send: async (messages) => void sent.push([...messages]),
    checkReceipts: async () => {},
  };

  beforeEach(() => {
    sent = [];
  });

  it('pushes a new notification to every phone the user is signed in on', async () => {
    await store.savePushToken(ALICE, PHONE, 'android');
    await store.savePushToken(ALICE, TABLET, 'ios');

    await withPush(store, fake).notify(ALICE, { kind: 'money_received', title: '@sam sent you $20.00', body: 'It’s in your wallet.', data: { txHash: '0xabc' } });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((m) => m.to).sort()).toEqual([PHONE, TABLET].sort());
    // What the app needs to open the right screen when it's tapped.
    expect(sent[0]![0]).toMatchObject({ title: '@sam sent you $20.00', body: 'It’s in your wallet.', data: { kind: 'money_received', txHash: '0xabc' } });
  });

  it('doesn’t push a notification that was a repeat, and so not stored', async () => {
    await store.savePushToken(ALICE, PHONE, 'android');
    const pushing = withPush(store, fake);

    expect(await pushing.notify(ALICE, { kind: 'money_received', title: 'a', body: 'b', key: 'received:0x1' })).toBe(true);
    expect(await pushing.notify(ALICE, { kind: 'money_received', title: 'a', body: 'b', key: 'received:0x1' })).toBe(false);

    expect(sent).toHaveLength(1);
  });

  it('keeps something that happened hours ago in the inbox, without buzzing the phone', async () => {
    await store.savePushToken(ALICE, PHONE, 'android');

    await withPush(store, fake).notify(ALICE, { kind: 'money_received', title: 'a', body: 'b', at: new Date(Date.now() - 3 * 60 * 60 * 1000) });

    expect(sent).toHaveLength(0);
    expect(await store.listNotifications(ALICE)).toHaveLength(1);
  });

  it('sends nothing for a user with no phones to push to', async () => {
    await withPush(store, fake).notify(ALICE, { kind: 'price_alert', title: 'ETH is above $3,000', body: '…' });

    expect(sent).toHaveLength(0);
  });
});

describe('push tokens', () => {
  it('keeps the ten most recent phones per account', async () => {
    for (let i = 0; i < 12; i++) {
      await store.savePushToken(ALICE, `ExponentPushToken[${String(i).padStart(22, 'x')}]`, 'android', new Date(Date.UTC(2026, 9, 1, 0, i)));
    }

    const tokens = await store.listPushTokens(ALICE);
    expect(tokens).toHaveLength(10);
    expect(tokens).not.toContain(`ExponentPushToken[${'0'.padStart(22, 'x')}]`);
  });
});

describe('createExpoPush', () => {
  type Call = { url: string; body: any };

  function fakeExpo(answer: (call: Call) => unknown) {
    const calls: Call[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      const call = { url, body: JSON.parse(String(init.body)) };
      calls.push(call);
      return new Response(JSON.stringify(answer(call)), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetch };
  }

  it('sends with sound, high priority and the app’s Android channel', async () => {
    const expo = fakeExpo((call) => ({ data: call.body.map(() => ({ status: 'ok', id: crypto.randomUUID() })) }));
    const push = createExpoPush({ store, fetch: expo.fetch });

    push.send([{ to: PHONE, title: 't', body: 'b', data: { kind: 'x' } }]);

    await vi.waitFor(() => expect(expo.calls).toHaveLength(1));
    expect(expo.calls[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(expo.calls[0]!.body).toEqual([{ to: PHONE, title: 't', body: 'b', data: { kind: 'x' }, sound: 'default', priority: 'high', channelId: 'default' }]);
  });

  it('forgets a phone Expo says the app is gone from, straight away', async () => {
    await store.savePushToken(ALICE, PHONE, 'android');
    await store.savePushToken(ALICE, TABLET, 'android');
    const expo = fakeExpo((call) => ({
      data: call.body.map((message: PushMessage) =>
        message.to === PHONE ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'ticket-1' },
      ),
    }));
    const push = createExpoPush({ store, fetch: expo.fetch });

    push.send([
      { to: PHONE, title: 't', body: 'b', data: {} },
      { to: TABLET, title: 't', body: 'b', data: {} },
    ]);

    await vi.waitFor(async () => expect(await store.listPushTokens(ALICE)).toEqual([TABLET]));
  });

  it('collects receipts once they’re ready, and forgets phones that never got the message', async () => {
    await store.savePushToken(ALICE, PHONE, 'android');
    let clock = Date.UTC(2026, 9, 17, 12);
    const expo = fakeExpo((call) =>
      call.url.endsWith('/send')
        ? { data: [{ status: 'ok', id: 'ticket-1' }] }
        : { data: { 'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } } } },
    );
    const push = createExpoPush({ store, fetch: expo.fetch, now: () => clock });

    await push.send([{ to: PHONE, title: 't', body: 'b', data: {} }]);
    expect(expo.calls).toHaveLength(1);

    // Not ready yet: Expo has receipts about 15 minutes after a send.
    await push.checkReceipts();
    expect(expo.calls).toHaveLength(1);

    clock += 16 * 60 * 1000;
    await push.checkReceipts();

    expect(expo.calls[1]!.body).toEqual({ ids: ['ticket-1'] });
    expect(await store.listPushTokens(ALICE)).toEqual([]);

    // Each ticket is asked about once.
    await push.checkReceipts();
    expect(expo.calls).toHaveLength(2);
  });

  it('a failed send costs the push, never the notification', async () => {
    const push = createExpoPush({
      store,
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(push.send([{ to: PHONE, title: 't', body: 'b', data: {} }])).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
