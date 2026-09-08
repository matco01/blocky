import { z } from 'zod';
import { INTENT_TYPES } from './intent';
import {
  AddressSchema,
  BaseUnitsSchema,
  ChainIdSchema,
  DecimalSchema,
  HexSchema,
  ResolvedRecipientSchema,
  ResolvedTokenSchema,
} from './primitives';

/**
 * A Plan is the deterministic, fully-resolved answer to an Intent.
 *
 * Built server-side from real quotes and real chain state. Everything the
 * confirmation card shows comes from here, and nothing here comes from the
 * model. If the model and the planner disagree about what is happening, the
 * planner wins and the user sees both.
 */

/* -------------------------------------------------------------------------- */
/*  Warnings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every reason a plan might deserve a second look. These drive both UI
 * treatment and policy: a `danger` warning forces confirmation even for an
 * amount that would otherwise auto-execute.
 */
export const WarningCodeSchema = z.enum([
  /** Recipient is not on the user's allowlist. Always forces confirmation. */
  'new_recipient',
  /** Destination has bytecode; a plain transfer there may be unrecoverable. */
  'recipient_is_contract',
  /** Token is not on our curated list. */
  'unverified_token',
  /** Quoted output is materially worse than the spot rate. */
  'high_price_impact',
  /** Amount is large relative to this user's normal behaviour. */
  'unusual_amount',
  /** Simulation reverted or could not be run. */
  'simulation_failed',
  /** Address matched a sanctions or known-scam list. */
  'address_flagged',
  /** Fee is a large fraction of the amount being moved. */
  'fee_heavy',
]);

export type WarningCode = z.infer<typeof WarningCodeSchema>;

export const WarningSchema = z.object({
  code: WarningCodeSchema,
  severity: z.enum(['info', 'warn', 'danger']),
  /** Plain language, written for someone who does not know what a nonce is. */
  message: z.string().min(1).max(280),
});

export type Warning = z.infer<typeof WarningSchema>;

/* -------------------------------------------------------------------------- */
/*  Value movement                                                             */
/* -------------------------------------------------------------------------- */

export const AssetDeltaSchema = z.object({
  token: ResolvedTokenSchema,
  /** Exact quantity in base units. The source of truth. */
  amount: BaseUnitsSchema,
  /** Same quantity, human-readable. Derived; never round-tripped back to exact. */
  displayAmount: DecimalSchema,
  /** Null when we have no trustworthy price for this token. */
  usdValue: DecimalSchema.nullable(),
});

export type AssetDelta = z.infer<typeof AssetDeltaSchema>;

/**
 * Fees, itemised.
 *
 * The UI shows `totalUsd` and nothing else — gas is never a decision put to the
 * user, and the Circle Paymaster surcharge in particular must never appear as
 * its own line. The breakdown exists for debugging and support.
 */
export const FeeSchema = z.object({
  totalUsd: DecimalSchema,
  paidIn: z.enum([
    /** Circle Gateway's gas-free USDC path. */
    'sponsored',
    /** Circle Paymaster: gas deducted in USDC from the transaction itself. */
    'usdc',
    /** Fallback only; means the user needed a native balance. Should be rare. */
    'native',
  ]),
  breakdown: z.object({
    networkUsd: DecimalSchema,
    /** Paymaster surcharge, where applicable. Folded into `totalUsd`. */
    paymasterUsd: DecimalSchema,
    /** Aggregator or bridge fee. */
    serviceUsd: DecimalSchema,
  }),
});

export type Fee = z.infer<typeof FeeSchema>;

/* -------------------------------------------------------------------------- */
/*  Execution payload                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A single prepared call, built by the planner.
 *
 * This is the only place raw calldata exists in the system, and it is always
 * constructed from a validated Intent by our own code — never parsed out of
 * model output.
 */
export const PreparedCallSchema = z.object({
  chainId: ChainIdSchema,
  to: AddressSchema,
  data: HexSchema,
  value: BaseUnitsSchema,
  /** Human description of this specific call, for the expandable detail view. */
  description: z.string(),
});

export type PreparedCall = z.infer<typeof PreparedCallSchema>;

export const SimulationSchema = z.object({
  status: z.enum(['success', 'reverted', 'unavailable']),
  revertReason: z.string().nullable(),
  /**
   * What the simulation says will actually arrive. When this disagrees with the
   * quote, this is what the user is shown — a quote is a promise, a simulation
   * is a measurement.
   */
  actualInflow: z.array(AssetDeltaSchema).nullable(),
});

export type Simulation = z.infer<typeof SimulationSchema>;

/* -------------------------------------------------------------------------- */
/*  The plan                                                                   */
/* -------------------------------------------------------------------------- */

export const PlanSchema = z.object({
  id: z.string().uuid(),
  intentType: z.enum(INTENT_TYPES),

  /** Planner-authored summary. This is the headline on the confirmation card. */
  summary: z.string().min(1).max(280),
  /** The model's stated rationale, carried through for comparison. */
  modelRationale: z.string().max(280),

  /** What leaves the user's wallet. */
  outflow: z.array(AssetDeltaSchema),
  /** What arrives. Empty for a plain outbound transfer. */
  inflow: z.array(AssetDeltaSchema),
  /** Present for transfers and bridges; null for swaps back to self. */
  recipient: ResolvedRecipientSchema.nullable(),

  fee: FeeSchema,
  warnings: z.array(WarningSchema),
  calls: z.array(PreparedCallSchema).min(1),
  simulation: SimulationSchema.nullable(),

  createdAt: z.string().datetime(),
  /**
   * Quotes go stale. Past this point the plan must be rebuilt rather than
   * executed — the UI counts down and re-plans automatically.
   */
  expiresAt: z.string().datetime(),
});

export type Plan = z.infer<typeof PlanSchema>;

/** True once a plan's quotes can no longer be trusted. */
export function isPlanExpired(plan: Plan, now: Date = new Date()): boolean {
  return new Date(plan.expiresAt).getTime() <= now.getTime();
}

/** The most serious warning attached to a plan, if any. */
export function highestSeverity(plan: Plan): Warning['severity'] | null {
  if (plan.warnings.some((w) => w.severity === 'danger')) return 'danger';
  if (plan.warnings.some((w) => w.severity === 'warn')) return 'warn';
  if (plan.warnings.some((w) => w.severity === 'info')) return 'info';
  return null;
}
