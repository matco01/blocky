import { router } from 'expo-router';
import { api } from './api';
import { handOffPlan } from './handoff';

/**
 * Pay a request: the server plans the send to whoever asked, for what they
 * asked, and the plan goes to the same Send screen every payment goes
 * through — fingerprint and all. The request settles itself when it lands.
 */
export async function payRequest(requestId: string): Promise<void> {
  const plan = await api.payRequest(requestId);
  handOffPlan(plan);
  router.push({ pathname: '/send', params: { planId: plan.id } });
}
