export interface Capability {
  title: string;
  action:
    | { kind: 'send'; text: string }
    | { kind: 'prefill'; text: string }
    /** Show the compact capability list itself — see `showCapabilities` in `chat.ts`. */
    | { kind: 'capabilities' };
}

/** The three things offered before the user has typed anything. */
export const STARTER_CAPABILITIES: Capability[] = [
  { title: 'What can you do?', action: { kind: 'capabilities' } },
  { title: "What's live on Arc?", action: { kind: 'send', text: "What's live on Arc right now?" } },
  { title: 'Send $', action: { kind: 'prefill', text: 'Send $' } },
];

/**
 * The compact answer to "what can you do" — real tappable actions instead of
 * a paragraph enumerating them. Mirrors the system prompt's "Available now"
 * list; keep the two in sync if a capability is added or removed there.
 */
export const ALL_CAPABILITIES: Capability[] = [
  { title: 'Send USDC', action: { kind: 'prefill', text: 'Send $' } },
  { title: 'My balance', action: { kind: 'send', text: "What's my balance?" } },
  { title: 'My contacts', action: { kind: 'send', text: 'Show my contacts' } },
  { title: 'Recent activity', action: { kind: 'send', text: 'Show my recent activity' } },
  { title: 'Spending limits', action: { kind: 'send', text: 'What are my spending limits?' } },
  { title: "What's live on Arc", action: { kind: 'send', text: "What's live on Arc right now?" } },
];
