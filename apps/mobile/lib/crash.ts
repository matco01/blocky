import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { config } from './config';

/**
 * Our own small crash reporter, instead of a third-party service: when the app
 * breaks, the error and where it happened go to Blocky's server log. No user
 * ID, no balances, no chat — just the error. At most a few per session, and
 * the same error only once.
 */
const sent = new Set<string>();
const MAX_PER_SESSION = 8;

export function reportCrash(error: unknown, where: string, fatal = false) {
  const e = error instanceof Error ? error : new Error(String(error));
  const key = `${where}:${e.message}`;
  if (sent.has(key) || sent.size >= MAX_PER_SESSION) return;
  sent.add(key);
  void fetch(`${config.apiUrl}/crash`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: e.message.slice(0, 500),
      stack: e.stack?.slice(0, 4000),
      where: where.slice(0, 120),
      fatal,
      version: Constants.expoConfig?.version ?? 'unknown',
      platform: Platform.OS,
    }),
  }).catch(() => {});
}

type Handler = (error: unknown, isFatal?: boolean) => void;
declare const ErrorUtils: { getGlobalHandler(): Handler; setGlobalHandler(handler: Handler): void } | undefined;

/** Catch errors nothing else caught, report them, then let React Native carry on as usual. */
export function installCrashReporting() {
  if (typeof ErrorUtils === 'undefined') return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportCrash(error, 'global', Boolean(isFatal));
    previous(error, isFatal);
  });
}
