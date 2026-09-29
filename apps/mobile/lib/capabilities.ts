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
  { title: 'Pay a friend', action: { kind: 'prefill', text: 'Pay @' } },
  { title: 'Start saving', action: { kind: 'prefill', text: 'Create a savings pot for ' } },
];

/**
 * The compact answer to "what can you do" — real tappable actions instead of
 * a paragraph enumerating them. Money first: Blocky is a money app, and most
 * people never need the investing row. Mirrors the system prompt's "Available"
 * list; keep the two in sync if a capability is added or removed there.
 *
 * Prefilled ones end where the user types next, so the cursor lands exactly
 * where the next keystroke belongs.
 */
export const ALL_CAPABILITIES: Capability[] = [
  // Everyday money
  { title: 'Pay a friend', action: { kind: 'prefill', text: 'Pay @' } },
  { title: 'Request money', action: { kind: 'prefill', text: 'Request $' } },
  { title: 'My balance', action: { kind: 'send', text: "What's my balance?" } },
  { title: 'Where did my money go?', action: { kind: 'send', text: 'Where did my money go this month?' } },
  { title: 'Set a budget', action: { kind: 'prefill', text: 'Set a monthly budget of $' } },
  { title: 'Savings pots', action: { kind: 'send', text: 'Show my savings pots' } },
  { title: 'Auto-save', action: { kind: 'prefill', text: 'Every week, put $' } },
  { title: 'Recent activity', action: { kind: 'send', text: 'Show my recent activity' } },
  // Investing, lighter
  { title: 'Buy a stock', action: { kind: 'prefill', text: 'Buy Apple for $' } },
  { title: 'Buy crypto', action: { kind: 'prefill', text: 'Get ETH on Arbitrum for $' } },
  { title: 'Price alert', action: { kind: 'prefill', text: 'Alert me when ETH hits $' } },
  { title: 'How are markets today?', action: { kind: 'send', text: 'How are markets doing today?' } },
];

/**
 * "What can you do?" typed at any point in the conversation, in the usual
 * phrasings. Whole-message only: "what can you do about my rent?" is a real
 * question for Blocky, not a request for the menu.
 */
const CAPABILITIES_QUESTION =
  /^(?:(?:hey|hi|so|ok|okay|and)\s+)?(?:blocky\s*,?\s*)?(?:what\s+(?:else\s+)?(?:can|could)\s+(?:you|u|blocky)\s+do(?:\s+for\s+me)?|what\s+do\s+you\s+do|what\s+are\s+you\s+able\s+to\s+do|what\s+are\s+your\s+(?:features|capabilities|skills)|show\s+me\s+what\s+you\s+can\s+do|help)(?:\s*,?\s*blocky)?\s*[?.!]*$/i;

export function isCapabilitiesQuestion(text: string): boolean {
  return CAPABILITIES_QUESTION.test(text.trim());
}
