/**
 * A deliberately small markdown parser for the agent's replies.
 *
 * The agent is told to use exactly this subset: paragraphs, single-level bullet
 * and numbered lists, **bold**, and `code` for addresses. Anything else it
 * produces anyway degrades to plain text rather than rendering as raw
 * symbols — a heading becomes a bold line, a code fence becomes its contents.
 *
 * Written here rather than pulled in as a dependency so the chat looks exactly
 * as designed, and because it is small enough to test completely.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
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
      blocks.push({ type: 'paragraph', inlines: [{ text: (heading[1] ?? '').trim(), bold: true }] });
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

  return mergeAdjacent(parts);
}

function mergeAdjacent(parts: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous && !previous.bold && !previous.italic && !previous.code && !part.bold && !part.italic && !part.code) {
      previous.text += part.text;
    } else if (part.text) {
      merged.push({ ...part });
    }
  }
  return merged;
}
