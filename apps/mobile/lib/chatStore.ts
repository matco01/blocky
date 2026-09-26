import { File, Paths } from 'expo-file-system';
import type { ChatMessage } from './chat';

/**
 * The conversation, kept on the phone between launches — so Blocky still
 * knows what was just discussed, proposed and sent after the app is closed.
 *
 * A file in the app's private documents folder: nothing leaves the device,
 * and "reset" deletes it. Only the recent end is kept, and every read and
 * write is best-effort — a chat that can't be saved is still a chat.
 */

/** Enough to scroll back through, and more than the agent is ever sent. */
const KEEP = 60;

interface Saved {
  version: 1;
  messages: ChatMessage[];
  /** Chat plans already approved and sent, so their cards stay "On its way". */
  sentPlanIds: string[];
}

function file(): File {
  return new File(Paths.document, 'blocky-chat.json');
}

export function loadChat(): Saved | null {
  try {
    const f = file();
    if (!f.exists) return null;
    const saved = JSON.parse(f.textSync()) as Saved;
    return saved.version === 1 && Array.isArray(saved.messages) ? saved : null;
  } catch {
    return null;
  }
}

export function saveChat(messages: readonly ChatMessage[], sentPlanIds: readonly string[]): void {
  try {
    // Errors are a moment's news, not history; capability lists are rebuilt on demand.
    const kept = messages.filter((m) => m.role !== 'error').slice(-KEEP);
    const saved: Saved = { version: 1, messages: kept, sentPlanIds: [...sentPlanIds] };
    file().write(JSON.stringify(saved));
  } catch {
    // Best-effort: the chat keeps working without it.
  }
}

export function clearChat(): void {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // Nothing to clear, or nothing we can do.
  }
}
