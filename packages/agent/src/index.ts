/**
 * @blocky/agent — the model, and the boundary around it.
 *
 * The agent loop, its tools and its prompt live here. The API constructs the
 * Anthropic client and passes it in; nothing else talks to the model.
 *
 * What leaves here is either prose for the user or a validated `Intent`. Never
 * calldata, never a key, and never a decision about whether something may run —
 * that belongs to `evaluatePolicy`.
 */

export * from './agent';
export * from './tools';
export * from './system-prompt';
