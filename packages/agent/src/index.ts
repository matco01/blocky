/**
 * @blocky/agent — the model, and the boundary around it.
 *
 * The Anthropic SDK is reachable only through this package, the same way vendor
 * chain SDKs are confined to `@blocky/wallet-core`. Nothing outside imports it.
 *
 * What leaves here is either prose for the user or a validated `Intent`. Never
 * calldata, never a key, and never a decision about whether something may run —
 * that belongs to `evaluatePolicy`.
 */

export * from './agent';
export * from './tools';
export * from './system-prompt';
