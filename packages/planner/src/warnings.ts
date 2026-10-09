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
      message: 'The fees are a large share of this amount. Moving more at once is cheaper.',
    },
  ];
}

/**
 * What the dry run found, as warnings.
 *
 * Only a revert is `danger`, and the context only reports one after seeing it
 * twice, so a red card means "this will fail", not "the check hiccupped".
 * Not being able to run the check at all (no simulation on that network, the
 * endpoint down, a timeout) is `warn`: the user should know it wasn't checked,
 * but crying wolf on every swap would teach them to ignore the red one.
 */
export function simulationWarnings(simulation: Simulation | null): Warning[] {
  if (simulation === null || simulation.status === 'unavailable') {
    return [
      {
        code: 'simulation_failed',
        severity: 'warn',
        message: "This couldn't be checked in advance. It will most likely go through as usual.",
      },
    ];
  }

  if (simulation.status === 'success') return [];

  return [
    {
      code: 'simulation_failed',
      severity: 'danger',
      message: `A test run says this would fail on-chain${simulation.revertReason ? `: ${simulation.revertReason}` : '.'} Nothing has been sent.`,
    },
  ];
}

/**
 * The foresight warning: money landing where the user cannot move it again.
 *
 * Off Arc, every transaction — including sending the USDC back — is paid in
 * that chain's own gas token, and nobody pays it for them. So USDC moved to
 * Base arrives fine but sits there until the user holds a little ETH on Base.
 * Saying so before they approve is cheap; discovering it afterwards is a
 * support ticket.
 *
 * `warn`, not `danger`: the money is not lost and the move may be exactly what
 * the user wants. Making this `danger` would force confirmation on ordinary
 * moves and train people to tap through warnings, which costs more safety than
 * it buys.
 */
export function destinationWarnings(args: { chainName: string; gasToken: string; canActThere: boolean }): Warning[] {
  if (args.canActThere) return [];

  return [
    {
      code: 'destination_no_gas_route',
      severity: 'warn',
      message: `Fees on ${args.chainName} are paid in ${args.gasToken}, and you don't have enough there. This will arrive, but you won't be able to move it again until you get a little ${args.gasToken} on ${args.chainName}.`,
    },
  ];
}
