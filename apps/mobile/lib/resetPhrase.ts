/**
 * Whether a typed message means "start over" rather than something to ask the
 * agent. Answered locally, the same way "what can you do" is: there is
 * nothing to disambiguate — resetting has exactly one meaning — so a model
 * round-trip would add only latency and a chance of the agent chatting back
 * instead of a tool it doesn't have.
 *
 * Deliberately requires both a reset-shaped verb *and* a word for the
 * conversation itself, not either alone: "reset my spending limit" and
 * "clear my recent activity" are real requests for the agent and must not be
 * swallowed here just because they share a word with "reset the chat".
 *
 * Kept in its own file, with no other imports, on purpose: `chat.ts` pulls in
 * `api.ts`, which validates the app's env at import time, and this needs to
 * stay testable without any of that.
 */
const RESET_PHRASE =
  /^(?:please\s+|can you\s+|could you\s+)?(?:reset|clear|wipe|restart|delete|forget)\b[\s\S]*\b(?:chat|conversation|messages?|history)\b|^(?:please\s+)?(?:start over|new chat)\b/i;

export function isResetPhrase(text: string): boolean {
  return RESET_PHRASE.test(text.trim());
}
