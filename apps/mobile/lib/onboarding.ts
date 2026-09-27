import { useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * Whether a signed-in user still has to pick their @name — the one step of
 * onboarding after signing up. Checked once per sign-in; if the server can't
 * be reached, the app opens anyway rather than locking them out of their money.
 */

type State = 'checking' | 'needs-username' | 'done';

let state: State = 'checking';
let checkedFor: string | null = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

/** Look up, once per user, whether they have a name yet. */
export function checkOnboarding(userId: string): void {
  if (checkedFor === userId) return;
  checkedFor = userId;
  set('checking');
  api.me().then(
    (me) => set(me.username ? 'done' : 'needs-username'),
    () => set('done'),
  );
}

/** Called when they've claimed a name: on into the app. */
export function finishOnboarding(): void {
  set('done');
}

/** Forget the check — on sign-out, so the next account is checked afresh. */
export function resetOnboarding(): void {
  checkedFor = null;
  set('checking');
}

export function useOnboarding(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
