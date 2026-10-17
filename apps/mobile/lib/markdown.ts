/**
 * A deliberately small markdown parser for the agent's replies.
 *
 * The agent is told to use exactly this subset: paragraphs, `##` section
 * headings, single-level bullet and numbered lists, **bold**, `code` for
 * addresses, and a closing "Sources:" line. Anything else it produces anyway
 * degrades to plain text rather than rendering as raw symbols — a code fence
 * becomes its contents.
 *
 * On top of the markdown, price moves ("fell 2.1%", "+0.7%") are picked out so
 * the chat can colour them: a market recap is mostly numbers going up or down,
 * and the direction is the thing the eye wants first.
 *
 * Written here rather than pulled in as a dependency so the chat looks exactly
 * as designed, and because it is small enough to test completely.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** A price move: which way it went, for colouring. */
  move?: 'up' | 'down';
}

export type Block =
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'heading'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  /** "Sources: CNBC, Reuters" — set apart, small, at the foot of a reply. */
  | { type: 'source'; inlines: Inline[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const SOURCE = /^\s*(?:sources?|via)\s*:\s*(.+)$/i;
const FENCE = /^\s*```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ type: 'paragraph', inlines: parseInline(text) });
    paragraph = [];
  };

  const flushList = () => {
    if (list && list.items.length > 0) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    }
    list = null;
  };

  for (const line of lines) {
    // Fences are dropped; their contents flow through as ordinary text.
    if (FENCE.test(line)) continue;

    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    const item = bullet ?? numbered;

    if (item) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((item[1] ?? '').trim());
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      flushList();
      // Bold markers inside a heading are noise: the heading is already set apart.
      const text = (heading[1] ?? '').replace(/\*\*/g, '').trim();
      if (text) blocks.push({ type: 'heading', inlines: parseInline(text) });
      continue;
    }

    const sourceLine = line.match(SOURCE);
    if (sourceLine) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'source', inlines: parseInline((sourceLine[1] ?? '').trim()) });
      continue;
    }

    // A plain line straight after a list item continues that item.
    if (list && paragraph.length === 0) {
      const items: string[] = (list as { items: string[] }).items;
      items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line.trim()}`;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

/**
 * `**bold**`, `*italic*` and `` `code` ``. Unmatched markers stay literal, and
 * underscores are never treated as emphasis — they appear in addresses and
 * identifiers far more often than as intended formatting.
 */
// No lookbehind: not every JavaScript engine on a phone supports it. The italic
// branch still requires non-space characters just inside both asterisks.
const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*(?!\s)[^*\n]*?[^*\s\n]\*)/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > last) parts.push({ text: text.slice(last, index) });

    if (token.startsWith('**')) parts.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) parts.push({ text: token.slice(1, -1), code: true });
    else parts.push({ text: token.slice(1, -1), italic: true });

    last = index + token.length;
  }

  if (last < text.length) parts.push({ text: text.slice(last) });

  // Addresses never carry a move; everything else is scanned for one.
  return mergeAdjacent(parts.flatMap((part) => (part.code ? [part] : splitMoves(part))));
}

const DOWN_WORDS = new Set([
  'down', 'fell', 'falls', 'fallen', 'lost', 'loses', 'dropped', 'drops', 'slid', 'slides', 'sank', 'sinks',
  'declined', 'declines', 'tumbled', 'tumbles', 'plunged', 'plunges', 'slipped', 'slips', 'sagged', 'shed', 'sheds',
]);

/**
 * A price move: a signed percentage ("+0.7%", "−2.1%"), or a percentage right
 * after a word that says which way ("fell 2.1%", "up about 3%"). Only the
 * number is marked, so the sentence around it reads as it was written.
 *
 * The sign must start a word, so a range like "1-2%" is not read as "−2%".
 * "up to 5%" is a limit, not a move, and doesn't match: nothing but a
 * hedge word ("about", "nearly"…) may sit between the verb and the number.
 */
const MOVE =
  /(^|[\s(])([+\-−]\d+(?:\.\d+)?%)|\b(up|down|rose|rises|risen|gained|gains|climbed|climbs|jumped|jumps|rallied|rallies|surged|surges|soared|soars|added|adds|fell|falls|fallen|lost|loses|dropped|drops|slid|slides|sank|sinks|declined|declines|tumbled|tumbles|plunged|plunges|slipped|slips|sagged|shed|sheds)(\s+(?:by\s+)?(?:about\s+|roughly\s+|nearly\s+|almost\s+|over\s+|around\s+|more than\s+)?)(\d+(?:\.\d+)?%)/gi;

function splitMoves(part: Inline): Inline[] {
  const { text, ...format } = part;
  const out: Inline[] = [];
  let last = 0;

  for (const match of text.matchAll(MOVE)) {
    const start = match.index ?? 0;
    // Signed form: [lead, number]. Worded form: [word, gap, number].
    const signed = match[2];
    const lead = signed ? (match[1] ?? '') : `${match[3] ?? ''}${match[4] ?? ''}`;
    const number = signed ?? match[5] ?? '';
    const direction: 'up' | 'down' = signed
      ? signed.startsWith('+')
        ? 'up'
        : 'down'
      : DOWN_WORDS.has((match[3] ?? '').toLowerCase())
        ? 'down'
        : 'up';

    const numberAt = start + lead.length;
    if (numberAt > last) out.push({ ...format, text: text.slice(last, numberAt) });
    out.push({ ...format, text: number, move: direction });
    last = numberAt + number.length;
  }

  if (out.length === 0) return [part];
  if (last < text.length) out.push({ ...format, text: text.slice(last) });
  return out;
}

const isPlain = (part: Inline) => !part.bold && !part.italic && !part.code && !part.move;

function mergeAdjacent(parts: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous && isPlain(previous) && isPlain(part)) {
      previous.text += part.text;
    } else if (part.text) {
      merged.push({ ...part });
    }
  }
  return merged;
}
