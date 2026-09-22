import { z } from 'zod';
import { INTENT_TYPES } from './intent';
import { formatUsd, parseUsd } from './money';
import { isPlanExpired, type Plan } from './plan';
import { AddressSchema, DecimalSchema } from './primitives';

/**
 * The policy engine: the thing standing between an agent and someone's money.
 *
 * It is a pure function of (policy, plan, spend-so-far). No I/O, no clock
 * beyond an injected `now`, no surprises — so it can be exhaustively tested,
 * which is the point.
 *
 * This runs in two places on purpose:
 *
 *  - here, server-side, where it can explain itself in plain language; and
 *  - on-chain, in the session key's validator, where the caps hold even if this
 *    server is fully compromised.
 *
 * The on-chain limits are the real guarantee. This is the layer that makes the
 * guarantee legible.
 */

export const PolicySchema = z.object({
  /**
   * Whether the agent's proposals may skip the review screen.
   *
   * Every transfer needs the user's fingerprint either way — the agent has no
   * key and cannot sign. What this switches is how much ceremony stands in
   * front of that fingerprint: off, a plan opens the full review screen; on, a
   * plan inside the caps below is offered as a single tap.
   *
   * Off by default, because the caps only mean something once the user has
   * seen what the agent proposes when supervised.
   */
  enabled: z.boolean(),

  /** Hard ceiling for a single action. Over this, the agent refuses outright. */
  perTxCapUsd: DecimalSchema,
  /** Hard ceiling for a rolling 24h window across all agent actions. */
  dailyCapUsd: DecimalSchema,
  /** At or below this, and with no warnings, the agent may act unattended. */
  autoExecuteThresholdUsd: DecimalSchema,

  /** Intent types the agent may perform at all. */
  allowedActions: z.array(z.enum(INTENT_TYPES)),
  /** Token symbols the agent may touch. Null means "any verified token". */
  tokenAllowlist: z.array(z.string()).nullable(),
  /** Addresses the agent may send to unattended. */
  recipientAllowlist: z.array(AddressSchema),
});

export type Policy = z.infer<typeof PolicySchema>;

/**
 * Conservative defaults. A new user's agent can look but not touch.
 *
 * Loosening these is a deliberate act the user takes in settings, having seen
 * what the agent does when supervised. The reverse — starting permissive and
 * tightening after an incident — is not a thing you get to do twice.
 */
export const DEFAULT_POLICY: Policy = {
  enabled: false,
  perTxCapUsd: '100',
  dailyCapUsd: '250',
  autoExecuteThresholdUsd: '25',
  allowedActions: ['transfer'],
  tokenAllowlist: ['USDC'],
  recipientAllowlist: [],
};

/* -------------------------------------------------------------------------- */
/*  Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export const PolicyReasonCodeSchema = z.enum([
  'agent_disabled',
  'action_not_allowed',
  'token_not_allowed',
  'over_per_tx_cap',
  'over_daily_cap',
  'over_auto_threshold',
  'recipient_not_allowlisted',
  'unpriced_asset',
  'dangerous_warning',
  'address_flagged',
  'plan_expired',
]);

export type PolicyReasonCode = z.infer<typeof PolicyReasonCodeSchema>;

export const PolicyReasonSchema = z.object({
  code: PolicyReasonCodeSchema,
  /** Written to be shown to the user verbatim. */
  message: z.string(),
});

export type PolicyReason = z.infer<typeof PolicyReasonSchema>;

export const PolicyDecisionSchema = z.object({
  outcome: z.enum([
    /**
     * Inside every limit the user set: offered as a single tap straight to the
     * fingerprint, skipping the review screen. Not unattended — the agent has
     * no key, and every transfer still needs the user's own signature.
     */
    'auto_execute',
    /** Offer it to the user; they tap to sign with Face ID. */
    'require_confirmation',
    /** Not offered at all. The agent explains why and stops. */
    'deny',
  ]),
  reasons: z.array(PolicyReasonSchema),
  /** Total USD leaving the wallet, as evaluated. Null if unpriceable. */
  outflowUsd: DecimalSchema.nullable(),
  /** Rolling-window spend including this plan, for the audit log. */
  projectedDailySpendUsd: DecimalSchema.nullable(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

/* -------------------------------------------------------------------------- */
/*  Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export interface PolicyInput {
  policy: Policy;
  plan: Plan;
  /** Agent-initiated spend in the trailing 24h, excluding this plan. */
  spentTodayUsd: string;
  now?: Date;
}

/**
 * Total USD value leaving the wallet, or null if any outflow lacks a price.
 *
 * An unpriced outflow is not treated as zero. We cannot reason about a cap we
 * cannot measure, so it degrades to human confirmation.
 */
export function planOutflowUsd(plan: Plan): string | null {
  let total = 0n;
  for (const delta of plan.outflow) {
    if (delta.usdValue === null) return null;
    total += parseUsd(delta.usdValue);
  }
  total += parseUsd(plan.fee.totalUsd);
  return formatUsd(total);
}

export function evaluatePolicy({ policy, plan, spentTodayUsd, now }: PolicyInput): PolicyDecision {
  const denials: PolicyReason[] = [];
  const confirmations: PolicyReason[] = [];

  const outflowUsd = planOutflowUsd(plan);
  const projected =
    outflowUsd === null ? null : formatUsd(parseUsd(spentTodayUsd) + parseUsd(outflowUsd));

  /* --- Hard denials: the agent will not offer this at all ---------------- */

  if (plan.warnings.some((w) => w.code === 'address_flagged')) {
    denials.push({
      code: 'address_flagged',
      message: 'That address is on a sanctions or known-scam list.',
    });
  }

  if (!policy.allowedActions.includes(plan.intentType)) {
    denials.push({
      code: 'action_not_allowed',
      message: `Your settings don't allow the agent to ${plan.intentType}.`,
    });
  }

  const disallowedToken = plan.outflow.find(
    (delta) => policy.tokenAllowlist !== null && !policy.tokenAllowlist.includes(delta.token.symbol),
  );
  if (disallowedToken) {
    denials.push({
      code: 'token_not_allowed',
      message: `Your settings don't allow the agent to spend ${disallowedToken.token.symbol}.`,
    });
  }

  if (outflowUsd !== null) {
    if (parseUsd(outflowUsd) > parseUsd(policy.perTxCapUsd)) {
      denials.push({
        code: 'over_per_tx_cap',
        message: `That's over your ${policy.perTxCapUsd} per-transaction limit. You can raise it in Settings.`,
      });
    }
    if (projected !== null && parseUsd(projected) > parseUsd(policy.dailyCapUsd)) {
      denials.push({
        code: 'over_daily_cap',
        message: `That would put you over your ${policy.dailyCapUsd} daily limit.`,
      });
    }
  }

  if (denials.length > 0) {
    return { outcome: 'deny', reasons: denials, outflowUsd, projectedDailySpendUsd: projected };
  }

  /* --- Everything below downgrades to "ask the human" -------------------- */

  if (isPlanExpired(plan, now)) {
    confirmations.push({
      code: 'plan_expired',
      message: 'This quote expired — re-checking prices before continuing.',
    });
  }

  if (!policy.enabled) {
    confirmations.push({
      code: 'agent_disabled',
      message: 'Agent autonomy is off, so this needs your approval.',
    });
  }

  if (outflowUsd === null) {
    confirmations.push({
      code: 'unpriced_asset',
      message: "We couldn't price part of this, so it needs your approval.",
    });
  } else if (parseUsd(outflowUsd) > parseUsd(policy.autoExecuteThresholdUsd)) {
    confirmations.push({
      code: 'over_auto_threshold',
      message: `Above your ${policy.autoExecuteThresholdUsd} auto-approve limit.`,
    });
  }

  /*
   * An unknown recipient always needs a human, at any amount. This is the
   * single most important line in the file: it is what stops a prompt-injected
   * "send funds to 0x…" from ever executing unattended, regardless of how small
   * the attacker makes the amount to slip under the cap.
   */
  if (plan.recipient !== null && !plan.recipient.known) {
    confirmations.push({
      code: 'recipient_not_allowlisted',
      message: `First time sending to ${plan.recipient.display}.`,
    });
  }

  const danger = plan.warnings.find((w) => w.severity === 'danger');
  if (danger) {
    confirmations.push({ code: 'dangerous_warning', message: danger.message });
  }

  if (confirmations.length > 0) {
    return {
      outcome: 'require_confirmation',
      reasons: confirmations,
      outflowUsd,
      projectedDailySpendUsd: projected,
    };
  }

  return {
    outcome: 'auto_execute',
    reasons: [],
    outflowUsd,
    projectedDailySpendUsd: projected,
  };
}

