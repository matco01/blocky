import type { Simulation } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { simulationWarnings } from '../src/warnings';

/**
 * `simulationWarnings` on its own — not exercised through `planTransfer`,
 * which never calls it (a plain transfer has nothing worth dry-running; see
 * the comment in `plan.ts`). This is the swap path's function to reach for
 * once there's real contract logic that can fail in a way only a dry run
 * catches, so it keeps direct coverage here rather than none at all.
 */

const success: Simulation = { status: 'success', revertReason: null, actualInflow: null };

describe('no simulation was run', () => {
  it('warns that the dry run was unavailable', () => {
    const warnings = simulationWarnings(null);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'simulation_failed', severity: 'warn' });
  });
});

describe('a simulation ran', () => {
  it('says nothing when it succeeded', () => {
    expect(simulationWarnings(success)).toEqual([]);
  });

  it('treats a revert as danger, and includes the reason when there is one', () => {
    const warnings = simulationWarnings({
      status: 'reverted',
      revertReason: 'ERC20: insufficient allowance',
      actualInflow: null,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'simulation_failed', severity: 'danger' });
    expect(warnings[0]?.message).toContain('insufficient allowance');
  });

  it('still flags a revert with no stated reason', () => {
    const warnings = simulationWarnings({ status: 'reverted', revertReason: null, actualInflow: null });

    expect(warnings[0]?.severity).toBe('danger');
    expect(warnings[0]?.message).not.toContain('null');
  });

  it('treats "unavailable" as danger too, same as an actual revert', () => {
    // Same severity as a confirmed revert, despite this meaning "the attempt
    // was inconclusive" rather than "it will fail" — an existing asymmetry
    // with the null case below, which gets `warn` for the same "couldn't
    // tell" situation. Pinned as today's real behaviour, not endorsed as
    // clearly correct; nothing exercises this status yet either way.
    const warnings = simulationWarnings({ status: 'unavailable', revertReason: null, actualInflow: null });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'simulation_failed', severity: 'danger' });
  });
});
