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
  /**
   * Value is landing somewhere the user will not be able to move it again.
   *
   * Off Arc, every transaction is paid in that chain's own gas token, and
   * nobody pays it for the user. USDC moved to Base arrives, but stays put
   * until they hold a little ETH there. Saying so before the fact is cheap;
   * discovering it after is a support ticket.
   */
  'destination_no_gas_route',
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
 * user. The breakdown exists for debugging and support.
 */
export const FeeSchema = z.object({
  totalUsd: DecimalSchema,
  paidIn: z.enum([
    /**
     * Someone else pays. Not produced today — see `gas.ts` for why that tier
     * was removed — but kept so it can return with a real sponsoring
     * paymaster, and so plans stored before then still parse.
     */
    'sponsored',
    /** Gas in USDC, natively on Arc. */
    'usdc',
    /** Gas in the chain's own token, which the user holds there. */
    'native',
  ]),
  breakdown: z.object({
    networkUsd: DecimalSchema,
    /** Always '0' now that no paymaster is used; kept so stored plans still parse. */
    paymasterUsd: DecimalSchema,
    /** Aggregator or bridge fee — for a CCTP move, the most Circle may take. */
    serviceUsd: DecimalSchema,
    /** Blocky's own fee, when there is one — see `Plan.blockyFee`. */
    blockyUsd: DecimalSchema.optional(),
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

  /**
   * For value moving between chains: who carries it, and how long it should
   * take to land. The planner quotes every provider and keeps the one that
   * delivers the most. Absent on plans that stay on one chain, and on plans
   * stored before routes existed.
   */
  route: z
    .object({
      /**
       * Who carries it: `cctp` (Circle burns and re-mints), `across` (a
       * relayer pays out from its own funds), `across-swap` (Across bridges,
       * then swaps on arrival), `gas.zip` (the destination's gas token, from
       * Gas.zip's inventory).
       */
      provider: z.string().min(1).max(32),
      etaSeconds: z.number().int().nonnegative(),
      /** True when the fee shown is a ceiling and whatever it doesn't use arrives too. */
      feeIsCeiling: z.boolean(),
      /**
       * For a swap: the least that can land, in the received token's base
       * units. Below it the swap reverts and the user gets their USDC back.
       */
      minimumReceived: BaseUnitsSchema.optional(),
      /** A little of the destination's gas token delivered alongside, so the money can move again there. */
      gasTopUp: z.object({ provider: z.string().min(1).max(32) }).optional(),
    })
    .optional(),

  /**
   * Blocky's own fee: a share of what leaves, paid in the same transaction as
   * the move, to Blocky's address. Charged on swaps and moves that start on
   * Arc — plain sends are free, and so is coming home. Inside the all-or-
   * nothing batch, so if the move fails the fee is never taken. Already
   * counted in `fee.totalUsd`.
   */
  blockyFee: z
    .object({
      /** In the base units of the token leaving. */
      amount: BaseUnitsSchema,
      usd: DecimalSchema,
      recipient: AddressSchema,
      /** Basis points: 50 is 0.5%. */
      bps: z.number().int().min(1).max(100),
    })
    .optional(),

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

/**
 * How a plan's calls go out as transactions, in order.
 *
 * Consecutive calls that carry no value, on a chain that can batch, share one
 * transaction — on Arc, one all-or-nothing Multicall3From batch. Everything
 * else goes alone: a call carrying native value (the batching contract cannot
 * forward it), and every call on a chain with no batching contract. The app
 * sends by this and the server verifies by this, so both must agree — use
 * `groupCalls` from wallet-core, which knows which chains can batch.
 */
export function transactionsOf<T extends { value: string; chainId: number }>(
  calls: readonly T[],
  canBatch: (chainId: number) => boolean,
): T[][] {
  const groups: T[][] = [];
  let batch: T[] = [];

  for (const call of calls) {
    const batchable = BigInt(call.value) === 0n && canBatch(call.chainId);
    if (batchable && (batch.length === 0 || batch[0]!.chainId === call.chainId)) {
      batch.push(call);
      continue;
    }
    if (batchable) {
      groups.push(batch);
      batch = [call];
      continue;
    }
    if (batch.length > 0) groups.push(batch);
    batch = [];
    groups.push([call]);
  }

  if (batch.length > 0) groups.push(batch);
  return groups;
}
