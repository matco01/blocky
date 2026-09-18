import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

/** Replies taken from the real agent, so these tests match what the app actually receives. */

describe('blocks', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('First paragraph.\n\nSecond paragraph.');

    expect(blocks).toEqual([
      { type: 'paragraph', inlines: [{ text: 'First paragraph.' }] },
      { type: 'paragraph', inlines: [{ text: 'Second paragraph.' }] },
    ]);
  });

  it('keeps a single line break inside a paragraph', () => {
    expect(parseMarkdown('Line one\nLine two')).toEqual([
      { type: 'paragraph', inlines: [{ text: 'Line one\nLine two' }] },
    ]);
  });

  it('turns a real "what can you do" reply into a paragraph, a list, and a paragraph', () => {
    const reply = [
      "Here's what I can actually do right now:",
      '',
      '- Send USDC to a saved contact, an ENS name, or an address.',
      '- Tell you your balance.',
      '- List your saved contacts.',
      '',
      "I can't yet swap tokens — those are coming.",
    ].join('\n');

    const blocks = parseMarkdown(reply);

    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'paragraph']);
    const list = blocks[1];
    expect(list?.type === 'list' && list.items).toHaveLength(3);
  });

  it('starts a list directly under a paragraph line, with no blank line between', () => {
    const blocks = parseMarkdown('Your limits:\n- $100 per send\n- $250 per day');

    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('recognises numbered lists and keeps them separate from bullets', () => {
    const blocks = parseMarkdown('1. First\n2. Second\n- a bullet');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false });
  });

  it('continues a list item onto a wrapped line', () => {
    const blocks = parseMarkdown('- Send USDC to a contact\n  or an address.');

    expect(blocks[0]).toEqual({
      type: 'list',
      ordered: false,
      items: [[{ text: 'Send USDC to a contact or an address.' }]],
    });
  });

  it('degrades a heading to a bold line instead of showing hashes', () => {
    expect(parseMarkdown('## Your balance')).toEqual([
      { type: 'paragraph', inlines: [{ text: 'Your balance', bold: true }] },
    ]);
  });

  it('drops code fences but keeps what was inside', () => {
    expect(parseMarkdown('```\n0xabc\n```')).toEqual([{ type: 'paragraph', inlines: [{ text: '0xabc' }] }]);
  });

  it('returns nothing for empty or whitespace input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n ')).toEqual([]);
  });
});

describe('inline', () => {
  it('bolds an amount', () => {
    expect(parseInline('Your balance is **$42.50** USDC.')).toEqual([
      { text: 'Your balance is ' },
      { text: '$42.50', bold: true },
      { text: ' USDC.' },
    ]);
  });

  it('formats an address in backticks as code', () => {
    expect(parseInline('Send to `0x5a30…0003` now')).toEqual([
      { text: 'Send to ' },
      { text: '0x5a30…0003', code: true },
      { text: ' now' },
    ]);
  });

  it('leaves a lone asterisk alone', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15' }]);
  });

  it('leaves an unclosed bold marker as literal text', () => {
    expect(parseInline('this **is not closed')).toEqual([{ text: 'this **is not closed' }]);
  });

  it('never treats underscores as emphasis, since they appear in identifiers', () => {
    expect(parseInline('the field per_tx_cap_usd')).toEqual([{ text: 'the field per_tx_cap_usd' }]);
  });

  it('handles italics', () => {
    expect(parseInline('a *proposal*, not a send')).toEqual([
      { text: 'a ' },
      { text: 'proposal', italic: true },
      { text: ', not a send' },
    ]);
  });
});
