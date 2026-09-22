/**
 * Whether a typed message means "change the theme" rather than something to
 * ask the agent. Same reasoning as `resetPhrase.ts`: switching appearance has
 * no wallet logic behind it, nothing to look up, nothing to disambiguate that
 * a model would actually help with — just which of two values a setting
 * should hold. Answered locally.
 *
 * The one real subtlety is that "on"/"off" flip meaning depending on which
 * colour they're attached to: turning dark mode *off* means light, not dark.
 * Bare "on"/"off" are never trusted alone — always as part of a phrase like
 * "turn on" or "mode off" — because a bare "on" appears in all sorts of
 * ordinary sentences that have nothing to do with the theme.
 */

export type AppearanceCommand = 'dark' | 'light' | 'toggle' | null;

/** "toggle the theme" / "switch appearance" — no colour word needed at all. */
const BARE_TOGGLE = /^(?:please\s+)?(?:toggle|switch)\s+(?:the\s+)?(?:theme|appearance|mode)\b/i;

/** "switch to dark", "go light", "make it dark" — a direct assignment, no inversion. */
const DIRECT_TARGET = /\b(?:switch to|go|make it|set (?:it\s+)?to|set the theme to)\s+(dark|light)\b/i;

/** Requires "mode"/"theme" etc. nearby — a bare "dark"/"light" alone proves nothing. */
const CONTEXT_WORD = /\b(?:mode|theme|appearance|scheme)\b/i;

const ON_SIGNAL = /\b(?:turn (?:it\s+|the\s+)?on|switch (?:it\s+|the\s+)?on|enable|activate|mode\s+on|theme\s+on)\b/i;
const OFF_SIGNAL =
  /\b(?:turn (?:it\s+|the\s+)?off|switch (?:it\s+|the\s+)?off|disable|deactivate|mode\s+off|theme\s+off)\b/i;

export function matchAppearanceCommand(text: string): AppearanceCommand {
  const trimmed = text.trim();

  if (BARE_TOGGLE.test(trimmed)) return 'toggle';

  const direct = DIRECT_TARGET.exec(trimmed);
  if (direct) return direct[1]!.toLowerCase() as 'dark' | 'light';

  const hasDark = /\bdark\b/i.test(trimmed);
  const hasLight = /\blight\b/i.test(trimmed);
  if (!hasDark && !hasLight) return null;
  if (!CONTEXT_WORD.test(trimmed)) return null;
  // Mentions both, and the unambiguous "to <colour>" phrasing above didn't
  // already resolve it — genuinely unclear which way this is asking to go.
  if (hasDark && hasLight) return null;

  const mode: 'dark' | 'light' = hasDark ? 'dark' : 'light';
  const opposite: 'dark' | 'light' = mode === 'dark' ? 'light' : 'dark';

  if (/\btoggle\b/i.test(trimmed)) return 'toggle';
  if (ON_SIGNAL.test(trimmed)) return mode;
  // Turning dark mode *off* means light, and vice versa — the inversion is
  // the entire reason on/off need to be checked against which colour word
  // is actually present, rather than just returning "the colour mentioned".
  if (OFF_SIGNAL.test(trimmed)) return opposite;

  /*
   * A bare mention with a context word but no verb at all — "dark mode",
   * "dark theme please" — reads as a request to switch to it. Unless it's
   * phrased as a question ("is dark mode available?"), which is a real
   * question for the agent, not a command; an explicit verb above ("turn on
   * dark mode?") still counts even with a trailing "?" — only the verb-less
   * fallback needs this guard.
   */
  if (/\?\s*$/.test(trimmed)) return null;
  return mode;
}

/** The appearance a command lands on, given the one showing now. */
export function resolveAppearance(command: 'dark' | 'light' | 'toggle', current: 'dark' | 'light'): 'dark' | 'light' {
  if (command !== 'toggle') return command;
  return current === 'dark' ? 'light' : 'dark';
}
