import { describe, expect, it } from 'vitest';
import { isResetPhrase } from './resetPhrase';

/**
 * `isResetPhrase` gates a destructive, client-only action: it wipes the whole
 * conversation with no confirmation and no undo. A false positive here loses
 * someone's chat on a message that had nothing to do with resetting; a false
 * negative just means "reset the chat" falls through to the agent, which is
 * merely annoying. So the positive cases matter, but the negative cases —
 * ordinary requests that happen to share a word with a reset phrase — matter
 * more.
 */

describe('phrases that mean "start over"', () => {
  it.each([
    'reset the chat',
    'Reset chat',
    'reset this chat please',
    'clear the chat',
    'clear this conversation',
    'clear chat history',
    'wipe the chat',
    'restart the conversation',
    'delete all messages',
    'forget this conversation',
    'start over',
    'Start over.',
    'new chat',
    'please clear the chat',
    'can you reset this conversation',
    'could you wipe the chat history',
  ])('%s', (text) => {
    expect(isResetPhrase(text)).toBe(true);
  });
});

describe('ordinary requests that share a word with a reset phrase', () => {
  it.each([
    // A reset-shaped verb, but not aimed at the conversation.
    'reset my spending limit',
    'clear my recent activity',
    'delete my contact Sam',
    'forget my saved address',
    // A conversation-shaped noun, but no reset verb leading it.
    "what's the latest message in my chat",
    'show my recent activity and chat history', // real ask; "reset"/"clear" never appears
    'send $20 to sam and clear it with him', // "clear" present, but not first, and no chat/conversation word after it
  ])('%s', (text) => {
    expect(isResetPhrase(text)).toBe(false);
  });
});

describe('plain wallet requests', () => {
  it.each([
    "what's my balance?",
    'send $20 to sam',
    "what's live on arc right now?",
    'show my contacts',
    'what are my spending limits?',
  ])('%s', (text) => {
    expect(isResetPhrase(text)).toBe(false);
  });
});

describe('whitespace', () => {
  it('ignores leading and trailing whitespace', () => {
    expect(isResetPhrase('   reset the chat   ')).toBe(true);
  });
});
