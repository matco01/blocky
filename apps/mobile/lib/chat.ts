import type { Plan, PolicyDecision } from '@blocky/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type AgentResponse, type ChatTurn } from './api';
import { ALL_CAPABILITIES, type Capability } from './capabilities';
import { clearChat, loadChat, saveChat } from './chatStore';
import { restoreSentPlans, sentPlanIds, useSentVersion, wasPlanSent } from './handoff';
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
      /**
       * Proposed sends, in order — one card each. Never executed from here:
       * a card hands its plan to Send, and "Approve all" hands them all over.
       */
      plans: Array<{ plan: Plan; decision: PolicyDecision }>;
      /** Why a request could not become a plan, in words the user can act on. */
      note: string | null;
      /** Tappable actions, shown under the text. Set only by `showCapabilities`. */
      capabilities: Capability[] | null;
      /** Written by the app itself (see `sayLocally`), not by the agent. */
      local?: boolean;
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
// Unique across launches too: saved messages come back with their ids.
const launch = Date.now().toString(36);
const id = () => `m${launch}-${++nextId}`;

export function useChat({ onAppearance }: { onAppearance?: (mode: 'light' | 'dark') => void } = {}) {
  // Latest callback without re-creating `ask` when it changes.
  const onAppearanceRef = useRef(onAppearance);
  onAppearanceRef.current = onAppearance;

  // The conversation picks up where it left off, cards and all.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadChat();
    restoreSentPlans(saved?.sentPlanIds ?? []);
    return saved?.messages ?? [];
  });
  const sentVersion = useSentVersion();

  useEffect(() => {
    saveChat(messages, sentPlanIds());
  }, [messages, sentVersion]);
  const [busy, setBusy] = useState(false);
  // What Blocky says he's doing while a reply is on its way ("Creating your pot").
  const [activity, setActivity] = useState<string | null>(null);

  // The latest messages without re-creating `send` on every change.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const busyRef = useRef(false);

  /**
   * Bumped by `reset`. A request in flight when the chat is reset must not
   * resurrect its reply into the now-empty conversation once it lands — `ask`
   * checks this against the value it started with and drops a stale answer
   * rather than appending it.
   */
  const generationRef = useRef(0);

  const append = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const ask = useCallback(
    async (text: string, history: ChatTurn[]) => {
      const generation = generationRef.current;
      busyRef.current = true;
      setBusy(true);
      setActivity(null);

      try {
        const response = await api.agentChat(text, history, (label) => {
          if (generationRef.current === generation) setActivity(label);
        });
        if (generationRef.current === generation) {
          if (response.appearance) onAppearanceRef.current?.(response.appearance);
          append(fromResponse(response));
        }
      } catch (error) {
        if (generationRef.current === generation) {
          append({ id: id(), role: 'error', text: describeError(error), retry: { text, history } });
        }
      } finally {
        if (generationRef.current === generation) {
          busyRef.current = false;
          setBusy(false);
          setActivity(null);
        }
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

  /**
   * Append a user line and a plain assistant reply to it, locally — no
   * network, no history sent, no plan. For the handful of things answered
   * without the agent (see `showCapabilities`, and appearance commands in
   * `HomePage`) so the exchange still reads as one in the transcript, rather
   * than the typed text just vanishing with nothing to show it was handled.
   */
  const sayLocally = useCallback(
    (userText: string, replyText: string, capabilities: Capability[] | null = null) => {
      append({ id: id(), role: 'user', text: userText });
      append(assistantMessage(replyText, { capabilities, local: true }));
    },
    [append],
  );

  /**
   * "What can you do?" — answered locally, as tappable actions, instead of a
   * paragraph from the model. The list is fixed and already known; there is
   * nothing an LLM round-trip would add except latency and a wall of text.
   */
  const showCapabilities = useCallback(() => {
    if (busyRef.current) return;
    sayLocally('What can you do?', "Here's what I can help with:", ALL_CAPABILITIES);
  }, [sayLocally]);

  /**
   * "Reset the chat" — wipe the conversation and go back to the greeting
   * screen. Works even mid-request: nothing here waits on `busy`, because a
   * stuck or slow request is exactly when someone is likeliest to want out.
   */
  const reset = useCallback(() => {
    generationRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
    clearChat();
  }, []);

  return { messages, busy, activity, send, retry, showCapabilities, reset, sayLocally };
}

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>;

function assistantMessage(
  text: string,
  extra: Partial<Pick<AssistantMessage, 'plans' | 'note' | 'capabilities' | 'local'>> = {},
): AssistantMessage {
  return { id: id(), role: 'assistant', text, plans: [], note: null, capabilities: null, ...extra };
}

function fromResponse(response: AgentResponse): ChatMessage {
  const note =
    // Rare now: the planner's refusals go back to Blocky, who usually fixes or
    // explains them himself. Only a reason he didn't already say is added.
    response.kind === 'cannot_plan'
      ? response.status === response.reply
        ? null
        : response.status
      : response.kind === 'invalid_intent' || response.kind === 'exhausted'
        ? "I couldn't work that out. Try saying it another way."
        : null;

  return response.kind === 'plan'
    ? assistantMessage(response.reply, {
        plans: response.plans.length
          ? response.plans
          : response.plan && response.decision
            ? [{ plan: response.plan, decision: response.decision }]
            : [],
        note,
      })
    : assistantMessage(response.reply, { note });
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
    } else if (message.role === 'assistant' && message.local) {
      // Sent as the app's own note, not as something the agent said. Passed off
      // as the agent's words, "Switched to dark mode." made the agent "correct"
      // itself on the next message, since it knows it can't change settings.
      turns.push({
        role: 'assistant',
        content: `[Not written by you: the app handled the previous message itself and replied "${message.text}".]`,
      });
    } else if (message.role === 'assistant') {
      // What became of each card, not just that it was proposed: "now do the
      // rest" only makes sense if Blocky knows which ones went.
      const content = [
        message.text,
        ...message.plans.map(({ plan, decision }) =>
          wasPlanSent(plan.id)
            ? `Approved by the user and sent: ${plan.summary}`
            : decision.outcome === 'deny'
              ? `Proposed, but blocked by their settings: ${plan.summary}`
              : `Proposed, not approved (yet): ${plan.summary}`,
        ),
        message.note,
      ]
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
