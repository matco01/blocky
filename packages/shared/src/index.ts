/**
 * @blocky/shared — the contract between the model, the server, and the UI.
 *
 * If a type crosses a process boundary it is defined here, once, with a Zod
 * schema attached. Both sides validate; neither side trusts.
 */

export * from './money';
export * from './primitives';
export * from './intent';
export * from './plan';
export * from './policy';
