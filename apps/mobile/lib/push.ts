import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { api } from './api';
import { routeFor } from './notificationRoute';

/**
 * Push notifications on this phone: asking at a moment it makes sense,
 * telling the server where to push, and opening the right screen when one is
 * tapped.
 *
 * The server pushes everything it puts in the inbox (`apps/api/src/push.ts`):
 * money in, requests, alerts. Without permission nothing is lost — it all
 * still lands in the inbox; the phone just doesn't buzz.
 */

/** The Android channel the server sends to (`ANDROID_CHANNEL` in the API). */
const CHANNEL = 'default';

/**
 * Shown while the app is open too: "@sam sent you $20" deserves a banner
 * even mid-chat. Quiet, though — the app is already in their hand.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Screens that want to know a push just arrived while they're open — Home, to show the new balance at once. */
const arrivals = new Set<() => void>();
Notifications.addNotificationReceivedListener(() => arrivals.forEach((listener) => listener()));

export function onPushArrived(listener: () => void): () => void {
  arrivals.add(listener);
  return () => void arrivals.delete(listener);
}

/**
 * `on`: allowed. `ask`: not yet, and the system will still ask. `off`: turned
 * down for good — only Settings can turn it back on.
 */
export type PushPermission = 'on' | 'ask' | 'off';

export async function pushPermission(): Promise<PushPermission> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'on';
  return settings.canAskAgain ? 'ask' : 'off';
}

/**
 * Android shows nothing — and from Android 13 won't even ask — until the app
 * has a channel to post to.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Payments and alerts',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#367526',
  });
}

async function deviceToken(): Promise<string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
}

/** The token the server last heard about from this run of the app. */
let registered: string | null = null;

/**
 * Tell the server where to push, if notifications are allowed. Quietly does
 * nothing otherwise — no permission, no push service on this build (Android
 * needs the Firebase project wired in), offline: the inbox still has it all.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    await ensureChannel();
    if ((await pushPermission()) !== 'on') return false;
    const token = await deviceToken();
    if (token !== registered) {
      await api.savePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
      registered = token;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn notifications on — called from a button that has already said why.
 * Asks the system if it still will; if they turned it down for good, opens
 * Settings, the only place left that can.
 */
export async function turnOnPush(): Promise<boolean> {
  try {
    await ensureChannel();
    const permission = await pushPermission();
    if (permission === 'off') {
      await Linking.openSettings();
      return false;
    }
    if (permission === 'ask') {
      const answer = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
      if (!answer.granted) return false;
    }
    return registerForPush();
  } catch {
    return false;
  }
}

/**
 * Stop pushing this account's news to this phone. Called before signing out,
 * while there's still a session to say it with — and never for long: signing
 * out mustn't wait on a slow network.
 */
export async function unregisterPush(): Promise<void> {
  const forget = async () => {
    if ((await pushPermission()) !== 'on') return;
    await api.deletePushToken(registered ?? (await deviceToken()));
  };
  await Promise.race([forget().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
  registered = null;
}

/** Whether notifications are allowed, kept current — someone can flip it in Settings and come back. */
export function usePushPermission(): { permission: PushPermission | null; turnOn: () => Promise<void> } {
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const refresh = useCallback(() => {
    pushPermission().then(setPermission, () => setPermission(null));
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const turnOn = useCallback(async () => {
    await turnOnPush();
    refresh();
  }, [refresh]);

  return { permission, turnOn };
}

/**
 * While signed in: tell the server where to push, and open the right screen
 * for a notification tapped — whether the app was open, or the tap opened it.
 */
export function usePush(signedIn: boolean): void {
  useEffect(() => {
    if (signedIn) void registerForPush();
  }, [signedIn]);

  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    router.push(routeFor(last.notification.request.content.data));
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [signedIn, last]);
}
