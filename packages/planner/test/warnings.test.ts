import type { Simulation } from '@blocky/shared';
import { describe, expect, it } from 'vitest';
import { simulationWarnings } from '../src/warnings';

/**
 * `simulationWarnings` on its own. `planTransfer` never calls it (a plain
 * transfer has nothing worth dry-running; see the comment in `plan.ts`);
 * moves between chains, swaps and stock trades do, through `planBridge`.
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

  it('treats "unavailable" as a note, not an alarm, like no simulation at all', () => {
    // "We couldn't check" is not "it will fail". Red is kept for a confirmed
    // revert, so it still means something when it appears.
    const warnings = simulationWarnings({ status: 'unavailable', revertReason: null, actualInflow: null });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'simulation_failed', severity: 'warn' });
  });
});
