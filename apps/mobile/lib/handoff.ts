import type { Plan } from '@blocky/shared';
import { useSyncExternalStore } from 'react';

/**
 * Passing a plan from the chat to the Send screen, and the result back.
 *
 * The chat shows a card; tapping it opens the same confirmation screen a manual
 * send uses, so there is exactly one place where money is approved. The plan
 * travels by id through the route and is looked up here rather than being
 * serialised into the URL.
 *
 * Reads are non-destructive on purpose: a screen that renders twice (fast
 * refresh, strict mode) must see the same plan both times.
 */

const plans = new Map<string, Plan>();
const sent = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function handOffPlan(plan: Plan): void {
  plans.set(plan.id, plan);
}

export function getHandedOffPlan(planId: string | undefined): Plan | null {
  return planId ? (plans.get(planId) ?? null) : null;
}

/** Mark a chat plan as sent, by the id the chat knows it by. */
export function markPlanSent(planId: string): void {
  sent.add(planId);
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Put back what a saved conversation had sent — quietly: it runs while the chat first renders. */
export function restoreSentPlans(planIds: readonly string[]): void {
  for (const planId of planIds) sent.add(planId);
}

/** Every chat plan sent so far, by id — saved with the conversation. */
export function sentPlanIds(): string[] {
  return [...sent];
}

/** A number that changes whenever a plan is marked sent. */
export function useSentVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** Whether a chat plan was approved and sent — read outside React, for the agent's history. */
export function wasPlanSent(planId: string): boolean {
  return sent.has(planId);
}

/** Re-renders when any plan is marked sent. */
export function useSentPlans(): (planId: string) => boolean {
  useSyncExternalStore(subscribe, () => version);
  return (planId) => sent.has(planId);
}
