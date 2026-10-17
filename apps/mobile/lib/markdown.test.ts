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

  it('turns a heading into a section label, without the hashes or bold markers', () => {
    expect(parseMarkdown('## Your balance')).toEqual([{ type: 'heading', inlines: [{ text: 'Your balance' }] }]);
    expect(parseMarkdown('### **Why**')).toEqual([{ type: 'heading', inlines: [{ text: 'Why' }] }]);
  });

  it('sets a closing sources line apart', () => {
    const blocks = parseMarkdown('Stocks fell.\n\nSources: CNBC, Reuters');

    expect(blocks).toEqual([
      { type: 'paragraph', inlines: [{ text: 'Stocks fell.' }] },
      { type: 'source', inlines: [{ text: 'CNBC, Reuters' }] },
    ]);
  });

  it('only treats "Sources:" at the start of a line as a sources line', () => {
    expect(parseMarkdown('Two sources: CNBC and Reuters.')).toEqual([
      { type: 'paragraph', inlines: [{ text: 'Two sources: CNBC and Reuters.' }] },
    ]);
  });

  it('reads a structured market recap as headline, sections, bullets and sources', () => {
    const reply = [
      'Tech dragged stocks lower on Friday.',
      '',
      '## Stocks',
      '- **Nasdaq** fell 2.1%, its worst day in a month.',
      '- **Dow** up 0.7% as money rotated out of tech.',
      '',
      '## Why',
      '- AI spending worries hit chipmakers.',
      '',
      'Sources: CNBC, Reuters',
    ].join('\n');

    expect(parseMarkdown(reply).map((b) => b.type)).toEqual(['paragraph', 'heading', 'list', 'heading', 'list', 'source']);
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

  it('marks a percentage after a falling word as a move down, and only the number', () => {
    expect(parseInline('Nasdaq fell 2.1% on Friday')).toEqual([
      { text: 'Nasdaq fell ' },
      { text: '2.1%', move: 'down' },
      { text: ' on Friday' },
    ]);
  });

  it('marks a rising word, allowing a hedge in between', () => {
    expect(parseInline('the Dow was up about 0.7%')).toEqual([
      { text: 'the Dow was up about ' },
      { text: '0.7%', move: 'up' },
    ]);
  });

  it('marks signed percentages by their sign, including the typographic minus', () => {
    expect(parseInline('BTC +3.4%, ETH −1.2%, SOL -0.5%')).toEqual([
      { text: 'BTC ' },
      { text: '+3.4%', move: 'up' },
      { text: ', ETH ' },
      { text: '−1.2%', move: 'down' },
      { text: ', SOL ' },
      { text: '-0.5%', move: 'down' },
    ]);
  });

  it('keeps bold on a move inside bold text', () => {
    expect(parseInline('**Nasdaq −2.1%**')).toEqual([
      { text: 'Nasdaq ', bold: true },
      { text: '−2.1%', bold: true, move: 'down' },
    ]);
  });

  it('leaves ranges, limits and plain percentages alone', () => {
    expect(parseInline('roughly 1-2% lower')).toEqual([{ text: 'roughly 1-2% lower' }]);
    expect(parseInline('fees up to 5%')).toEqual([{ text: 'fees up to 5%' }]);
    expect(parseInline('a 0.5% fee')).toEqual([{ text: 'a 0.5% fee' }]);
  });

  it('never marks a move inside an address', () => {
    expect(parseInline('`fell 2%`')).toEqual([{ text: 'fell 2%', code: true }]);
  });

  it('handles italics', () => {
    expect(parseInline('a *proposal*, not a send')).toEqual([
      { text: 'a ' },
      { text: 'proposal', italic: true },
      { text: ', not a send' },
    ]);
  });
});
