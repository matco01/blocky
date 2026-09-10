import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/plan';
import { ALICE, KNOWN_RECIPIENT, fakeContext, transferIntent } from './factories';
import { IntentSchema, type ResolvedRecipient } from '@blocky/shared';

/**
 * Recipient resolution, from the planner's side of the seam.
 *
 * The rule under test throughout: a reference that does not resolve becomes a
 * question, never a best guess. Every case here is one where guessing would
 * send someone's money to the wrong address.
 */

function intent(overrides: Record<string, unknown> = {}) {
  return IntentSchema.parse(transferIntent(overrides));
}

const recipient = (over: Partial<ResolvedRecipient> = {}): ResolvedRecipient => ({
  ...KNOWN_RECIPIENT,
  ...over,
});

describe('an ENS name', () => {
  it('is carried onto the plan as the display, not the raw address', async () => {
    const plan = await buildPlan(
      intent({ recipient: { kind: 'ens', name: 'alice.eth' } }),
      fakeContext({
        resolveRecipient: async () =>
          recipient({ address: ALICE, display: 'alice.eth', ensName: 'alice.eth' }),
      }),
    );

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.recipient?.ensName).toBe('alice.eth');
      // The user approves what they can read.
      expect(plan.plan.summary).toContain('alice.eth');
      // But the transaction goes to the address.
      expect(plan.plan.calls[0]?.data).toContain(ALICE.slice(2).toLowerCase());
    }
  });

  it('fails rather than guessing when it does not resolve', async () => {
    const result = await buildPlan(
      intent({ recipient: { kind: 'ens', name: 'nobody.eth' } }),
      fakeContext({ resolveRecipient: async () => null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('unknown_recipient');
  });
});

describe('a saved contact', () => {
  it('resolves to the saved address and shows the label', async () => {
    const plan = await buildPlan(
      intent({ recipient: { kind: 'contact', label: 'Sam' } }),
      fakeContext({
        resolveRecipient: async () =>
          recipient({ address: ALICE, display: 'Sam', contactLabel: 'Sam', ensName: null }),
      }),
    );

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.recipient?.contactLabel).toBe('Sam');
      expect(plan.plan.summary).toContain('Sam');
    }
  });

  it('fails on a label the user never saved', async () => {
    // The model cannot invent a destination that works. This is the mechanism.
    const result = await buildPlan(
      intent({ recipient: { kind: 'contact', label: 'Definitely Not Saved' } }),
      fakeContext({ resolveRecipient: async () => null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('unknown_recipient');
  });
});

describe('being known is not the same as being saved', () => {
  it('still warns about a saved contact who is not on the allowlist', async () => {
    // Saving someone in your address book is not authorising the agent to pay
    // them unattended. `known` drives that, and it comes from the allowlist.
    const plan = await buildPlan(
      intent({ recipient: { kind: 'contact', label: 'Sam' } }),
      fakeContext({
        resolveRecipient: async () =>
          recipient({ display: 'Sam', contactLabel: 'Sam', known: false }),
      }),
    );

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.warnings.map((w) => w.code)).toContain('new_recipient');
    }
  });
});

describe('self', () => {
  it('resolves without needing a lookup', async () => {
    const plan = await buildPlan(
      intent({ recipient: { kind: 'self' } }),
      fakeContext({
        resolveRecipient: async () => recipient({ display: 'your own wallet', known: true }),
      }),
    );

    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.plan.summary).toContain('your own wallet');
  });
});
