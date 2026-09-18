import type { Plan, PolicyDecision } from '@blocky/shared';
import { useCallback, useRef, useState } from 'react';
import { ApiError, api, type AgentResponse, type ChatTurn } from './api';

/**
 * Chat state for the home screen.
 *
 * Held in memory for now: closing the app starts a fresh conversation. The
 * server is stateless, so each message carries the recent history with it.
 */

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      text: string;
      /** A proposed send. Never executed from here — the card hands it to Send. */
      plan: Plan | null;
      decision: PolicyDecision | null;
      /** Why a request could not become a plan, in words the user can act on. */
      note: string | null;
    }
  | {
      id: string;
      role: 'error';
      text: string;
      /** What to ask again on retry, with the history it was first asked with. */
      retry: { text: string; history: ChatTurn[] };
    };

/** How much conversation the agent sees. Matches the server's cap. */
const HISTORY_LIMIT = 20;

let nextId = 0;
const id = () => `m${++nextId}`;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);

  // The latest messages without re-creating `send` on every change.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const busyRef = useRef(false);

  const append = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const ask = useCallback(
    async (text: string, history: ChatTurn[]) => {
      busyRef.current = true;
      setBusy(true);

      try {
        append(fromResponse(await api.agentChat(text, history)));
      } catch (error) {
        append({ id: id(), role: 'error', text: describeError(error), retry: { text, history } });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [append],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;

      const history = toHistory(messagesRef.current);
      append({ id: id(), role: 'user', text: trimmed });
      void ask(trimmed, history);
    },
    [append, ask],
  );

  /** Ask a failed message again, in place — the user's message is not repeated. */
  const retry = useCallback(
    (errorId: string) => {
      const failed = messagesRef.current.find((m) => m.id === errorId);
      if (!failed || failed.role !== 'error' || busyRef.current) return;

      setMessages((current) => current.filter((m) => m.id !== errorId));
      void ask(failed.retry.text, failed.retry.history);
    },
    [ask],
  );

  return { messages, busy, send, retry };
}

function fromResponse(response: AgentResponse): ChatMessage {
  const note =
    response.kind === 'cannot_plan'
      ? response.status
      : response.kind === 'invalid_intent' || response.kind === 'exhausted'
        ? "I couldn't work that out. Try saying it another way."
        : null;

  return {
    id: id(),
    role: 'assistant',
    text: response.reply,
    plan: response.kind === 'plan' ? response.plan : null,
    decision: response.kind === 'plan' ? response.decision : null,
    note,
  };
}

/**
 * The conversation as text turns for the server.
 *
 * An assistant turn that was only a card still tells the model what it
 * proposed, so "actually make it $10" has something to refer to.
 */
function toHistory(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ role: 'user', content: message.text });
    } else if (message.role === 'assistant') {
      const content = [message.text, message.plan ? `Proposed: ${message.plan.summary}` : null, message.note]
        .filter(Boolean)
        .join('\n');
      if (content) turns.push({ role: 'assistant', content: content.slice(0, 4000) });
    }
  }

  return turns.slice(-HISTORY_LIMIT);
}

function describeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return "The assistant isn't switched on on the server yet.";
  }
  if (error instanceof ApiError && error.code === 'wallet_not_ready') {
    return 'Your wallet is still being set up. Try again in a moment.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
