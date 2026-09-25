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
  { title: 'Send $', action: { kind: 'prefill', text: 'Send $' } },
  { title: 'Buy crypto', action: { kind: 'prefill', text: 'Buy HYPE with $' } },
];

/**
 * The compact answer to "what can you do" — real tappable actions instead of
 * a paragraph enumerating them. Mirrors the system prompt's "Available now"
 * list; keep the two in sync if a capability is added or removed there.
 *
 * Prefilled ones end where the user types the amount, so the cursor lands
 * exactly where the next keystroke belongs.
 */
export const ALL_CAPABILITIES: Capability[] = [
  { title: 'Send USDC', action: { kind: 'prefill', text: 'Send $' } },
  { title: 'Buy ETH', action: { kind: 'prefill', text: 'Get ETH on Arbitrum for $' } },
  { title: 'Buy HYPE', action: { kind: 'prefill', text: 'Buy HYPE with $' } },
  { title: 'Move to another chain', action: { kind: 'prefill', text: 'Move to Base, with a bit of gas: $' } },
  { title: 'My balance', action: { kind: 'send', text: "What's my balance?" } },
  { title: 'Token prices', action: { kind: 'send', text: "What are ETH and HYPE worth right now?" } },
  { title: 'How is the market?', action: { kind: 'send', text: "How's the crypto market doing today?" } },
  { title: 'Crypto news', action: { kind: 'send', text: "What's the biggest crypto news today?" } },
  { title: 'Recent activity', action: { kind: 'send', text: 'Show my recent activity' } },
  { title: 'My contacts', action: { kind: 'send', text: 'Show my contacts' } },
  { title: 'Spending limits', action: { kind: 'send', text: 'What are my spending limits?' } },
  { title: "What's live on Arc", action: { kind: 'send', text: "What's live on Arc right now?" } },
];
