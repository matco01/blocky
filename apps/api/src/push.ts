import { upstream } from '@blocky/wallet-core';
import type { NewNotification, Store } from './store';

/**
 * Push notifications, through Expo's push service: every notification Blocky
 * stores also goes to the user's phones, so "@sam sent you $20" reaches them
 * with the app closed. The inbox stays the record; a push is only the knock
 * on the door, and one that fails costs nothing but the knock.
 *
 * Expo relays to Apple and Google (FCM). Sending returns a ticket per message
 * saying whether Expo took it; a receipt, ready some minutes later, says
 * whether Apple or Google delivered it — and names phones the app was
 * uninstalled from, whose tokens are dropped so nothing is sent there again.
 */

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo's limits: messages per send, ticket ids per receipt request. */
const SEND_BATCH = 100;
const RECEIPT_BATCH = 1000;

/** Receipts are ready about 15 minutes after a send, and kept for a day. */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_KEPT_MS = 24 * 60 * 60 * 1000;

/** How often receipts are collected. */
export const RECEIPT_CHECK_MS = 15 * 60 * 1000;

/** A push is for now. Anything that happened longer ago than this waits in the inbox instead. */
const PUSH_FRESH_MS = 60 * 60 * 1000;

/** The Android channel the app creates for these (see `apps/mobile/lib/push.ts`). */
export const ANDROID_CHANNEL = 'default';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushService {
  /** Hand messages to Expo. Never rejects — delivery is best effort — so nobody need wait for it. */
  send(messages: readonly PushMessage[]): Promise<void>;
  /** Collect receipts for earlier sends, and forget tokens for phones that are gone. */
  checkReceipts(): Promise<void>;
}

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };
type Receipt = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

/** Expo's word for a token whose app is gone. */
const GONE = 'DeviceNotRegistered';

export function createExpoPush(options: {
  store: Pick<Store, 'forgetPushTokens'>;
  /** Only needed if "enhanced push security" is on for the Expo project. */
  accessToken?: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}): PushService {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  // Tickets waiting for a receipt: which token each went to, and when. In
  // memory — a restart loses some receipts, which only delays dropping a dead token.
  const pending = new Map<string, { token: string; sentAt: number }>();

  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
  };

  async function forget(tokens: string[]) {
    if (tokens.length > 0) await options.store.forgetPushTokens(tokens);
  }

  async function sendBatch(batch: readonly PushMessage[]) {
    const response = await doFetch(
      SEND_URL,
      upstream({
        method: 'POST',
        headers,
        body: JSON.stringify(
          batch.map((message) => ({ ...message, sound: 'default', priority: 'high', channelId: ANDROID_CHANNEL })),
        ),
      }),
    );
    if (!response.ok) throw new Error(`Expo push send failed with ${response.status}`);

    const tickets = ((await response.json()) as { data?: Ticket[] }).data ?? [];
    const gone: string[] = [];
    tickets.forEach((ticket, i) => {
      const token = batch[i]?.to;
      if (!token) return;
      if (ticket.status === 'ok') pending.set(ticket.id, { token, sentAt: now() });
      else if (ticket.details?.error === GONE) gone.push(token);
      else console.error(`push not accepted: ${ticket.details?.error ?? ticket.message ?? 'unknown error'}`);
    });
    await forget(gone);
  }

  return {
    async send(messages) {
      const batches: Promise<void>[] = [];
      for (let i = 0; i < messages.length; i += SEND_BATCH) {
        batches.push(
          sendBatch(messages.slice(i, i + SEND_BATCH)).catch((error: unknown) =>
            console.error('push send failed', error instanceof Error ? error.message : error),
          ),
        );
      }
      await Promise.all(batches);
    },

    async checkReceipts() {
      const due = [...pending].filter(([, ticket]) => now() - ticket.sentAt >= RECEIPT_DELAY_MS);
      for (let i = 0; i < due.length; i += RECEIPT_BATCH) {
        const batch = due.slice(i, i + RECEIPT_BATCH);
        const response = await doFetch(RECEIPTS_URL, upstream({ method: 'POST', headers, body: JSON.stringify({ ids: batch.map(([id]) => id) }) }));
        if (!response.ok) throw new Error(`Expo push receipts failed with ${response.status}`);

        const receipts = ((await response.json()) as { data?: Record<string, Receipt> }).data ?? {};
        const gone: string[] = [];
        for (const [id, ticket] of batch) {
          const receipt = receipts[id];
          // Not ready yet: asked again next time, until it's a day old.
          if (!receipt) {
            if (now() - ticket.sentAt > RECEIPT_KEPT_MS) pending.delete(id);
            continue;
          }
          pending.delete(id);
          if (receipt.status === 'error') {
            if (receipt.details?.error === GONE) gone.push(ticket.token);
            else console.error(`push not delivered: ${receipt.details?.error ?? receipt.message ?? 'unknown error'}`);
          }
        }
        await forget(gone);
      }
    },
  };
}

/**
 * The store, with every new notification also pushed to the user's phones.
 * Everything that tells a user something already goes through `notify`, so
 * this is the one place push happens. A notification dropped as a repeat is
 * not pushed again.
 */
export function withPush(store: Store, push: PushService, now: () => number = Date.now): Store {
  return {
    ...store,
    async notify(userId, notification) {
      const created = await store.notify(userId, notification);
      if (created && fresh(notification, now())) {
        const tokens = await store.listPushTokens(userId).catch(() => []);
        // Not awaited: whoever is telling the user — a send being confirmed, say — shouldn't wait on Expo.
        if (tokens.length > 0) void push.send(tokens.map((to) => message(to, notification)));
      }
      return created;
    },
  };
}

function fresh(notification: NewNotification, now: number): boolean {
  return !notification.at || now - notification.at.getTime() < PUSH_FRESH_MS;
}

/** What the phone shows, and what the app needs to open the right screen when it's tapped. */
function message(to: string, notification: NewNotification): PushMessage {
  const data = notification.data && typeof notification.data === 'object' ? (notification.data as Record<string, unknown>) : {};
  return { to, title: notification.title, body: notification.body, data: { ...data, kind: notification.kind } };
}

/** What an Expo push token looks like: `ExponentPushToken[…]`. Anything else is not one. */
export const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;
