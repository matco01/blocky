import {
  parseUsd,
  type ResolvedRecipient,
  type ResolvedToken,
  type Simulation,
  type Warning,
} from '@blocky/shared';

/**
 * Warning rules.
 *
 * Pure functions of already-resolved facts, so the question "when does the user
 * see this?" has an answer you can read rather than infer. Severity is doing
 * real work here: `danger` forces confirmation in `evaluatePolicy` no matter how
 * small the amount, so marking something `danger` is a decision about autonomy,
 * not about tone.
 */

/** Above this share of the amount being moved, the fee is worth mentioning. */
const FEE_HEAVY_RATIO = 0.05;

export function recipientWarnings(recipient: ResolvedRecipient, flagged: boolean): Warning[] {
  const warnings: Warning[] = [];

  if (flagged) {
    warnings.push({
      code: 'address_flagged',
      severity: 'danger',
      message: 'That address is on a sanctions or known-scam list.',
    });
  }

  if (!recipient.known) {
    warnings.push({
      code: 'new_recipient',
      severity: 'warn',
      message: `First time sending to ${recipient.display}.`,
    });
  }

  if (recipient.isContract) {
    // Not danger: sending to a contract is normal and often intended. It is
    // worth a look, and `evaluatePolicy` already stops any unknown recipient
    // from executing unattended regardless of this.
    warnings.push({
      code: 'recipient_is_contract',
      severity: 'warn',
      message: `${recipient.display} is a contract, not a wallet. Tokens sent there may not be recoverable.`,
    });
  }

  return warnings;
}

export function tokenWarnings(token: ResolvedToken): Warning[] {
  if (token.verified) return [];

  return [
    {
      code: 'unverified_token',
      severity: 'danger',
      message: `${token.symbol} is not on our verified list. Check the contract address before continuing.`,
    },
  ];
}

/**
 * Fee relative to the amount being moved.
 *
 * Only meaningful when both are priced. An unpriced outflow already forces
 * confirmation on its own in `evaluatePolicy`, so there is nothing to add here.
 */
export function feeWarnings(feeUsd: string, outflowUsd: string | null): Warning[] {
  if (outflowUsd === null) return [];

  const fee = parseUsd(feeUsd);
  const outflow = parseUsd(outflowUsd);

  if (fee === 0n || outflow === 0n) return [];

  // Integer comparison rather than a float ratio: fee/outflow > 0.05.
  if (fee * 100n <= outflow * BigInt(Math.round(FEE_HEAVY_RATIO * 100))) return [];

  return [
    {
      code: 'fee_heavy',
      severity: 'warn',
      message: 'The network fee is a large share of this transfer. Sending more at once is cheaper.',
    },
  ];
}

export function simulationWarnings(simulation: Simulation | null): Warning[] {
  if (simulation === null) {
    return [
      {
        code: 'simulation_failed',
        severity: 'warn',
        message: "We couldn't dry-run this before sending it.",
      },
    ];
  }

  if (simulation.status === 'success') return [];

  return [
    {
      code: 'simulation_failed',
      severity: 'danger',
      message:
        simulation.status === 'reverted'
          ? `This would fail on-chain${simulation.revertReason ? `: ${simulation.revertReason}` : '.'}`
          : "We couldn't dry-run this before sending it.",
    },
  ];
}

/**
 * The foresight warning: value landing where the user cannot act on it.
 *
 * Arc takes gas in USDC, and Circle Paymaster covers Base and Arbitrum. On
 * Ethereum, OP, Unichain, Polygon and Avalanche every transaction — including
 * sending the USDC back out — needs native token a Blocky user does not hold.
 *
 * A same-chain transfer can never trigger this: if the user can pay gas to send
 * on a chain, they can act on it. It earns its keep once value moves *between*
 * chains, where the destination's gas route is a different question from the
 * source's.
 *
 * `warn`, not `danger`: the money is not lost and the move may be exactly what
 * the user wants — paying someone on Polygon is a perfectly good reason. Making
 * this `danger` would force confirmation on ordinary sends and train people to
 * tap through warnings, which costs more safety than it buys.
 */
export function destinationWarnings(args: {
  chainName: string;
  canActThere: boolean;
  /** True when the user is only passing value through, e.g. a plain transfer out. */
  isOutboundTransfer: boolean;
}): Warning[] {
  // Sending to someone else means it is their problem to spend, not ours.
  if (args.canActThere || args.isOutboundTransfer) return [];

  return [
    {
      code: 'destination_no_gas_route',
      severity: 'warn',
      message: `Once this is on ${args.chainName} you won't be able to move or spend it without holding ${args.chainName} gas.`,
    },
  ];
}
