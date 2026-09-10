/**
 * @blocky/planner — Intent in, Plan out.
 *
 * The deterministic half of the system. The model states what the user wants;
 * this decides how, from real state, with its own arithmetic. Nothing here
 * trusts model output beyond the validated shape of an `Intent`, and the only
 * calldata in the product is assembled in `calls.ts`.
 *
 * Pure by construction: every chain read, price lookup and screening call
 * arrives through `PlannerContext`, so the whole thing is testable offline.
 */

export * from './context';
export * from './amount';
export * from './calls';
export * from './warnings';
export * from './plan';
