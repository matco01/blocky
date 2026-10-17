import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { textOf } from '../src/agent';

/** A text block, cited or not, the shape the API returns after a web search. */
function text(value: string, cited = false): Anthropic.ContentBlock {
  return {
    type: 'text',
    text: value,
    citations: cited
      ? [
          {
            type: 'web_search_result_location',
            cited_text: value,
            url: 'https://example.com',
            title: 'Example',
            encrypted_index: 'x',
          },
        ]
      : null,
  } as Anthropic.ContentBlock;
}

const reply = (...content: Anthropic.ContentBlock[]) => textOf({ content });

describe('textOf', () => {
  it('joins plain text blocks as they are', () => {
    expect(reply(text('Your balance is '), text('**$42.50**.'))).toBe('Your balance is **$42.50**.');
  });

  /** Blocks taken from a real Haiku 5.5 web-search reply. */
  it('drops a quote that opens a new sentence mid-line, and keeps one that finishes a sentence', () => {
    expect(
      reply(
        text('- **Nasdaq:** Tech and AI-related selling dragged the Nasdaq Composite down 2.14% to 26,140.03 '),
        text('At the close', true),
        text(' on Friday, October 16, 2026.\n- **Dow:** The Dow slipped 0.34% to 52,002.41, with gains in energy names '),
        text("partially mitigating the Dow's losses.", true),
      ),
    ).toBe(
      '- **Nasdaq:** Tech and AI-related selling dragged the Nasdaq Composite down 2.14% to 26,140.03 on Friday, October 16, 2026.\n' +
        "- **Dow:** The Dow slipped 0.34% to 52,002.41, with gains in energy names partially mitigating the Dow's losses.",
    );
  });

  it("drops the source's restatement of what the bullet already said", () => {
    expect(
      reply(
        text('- **Nasdaq** fell 2.14% to 26,140.03, down about 4.5% for the week. '),
        text('The Nasdaq Composite shed 2.14% to close at 26,140.03', true),
      ),
    ).toBe('- **Nasdaq** fell 2.14% to 26,140.03, down about 4.5% for the week.');
  });

  it('keeps a quote that is the whole of a line', () => {
    expect(reply(text('## Why\n- '), text('AI spending worries hit chipmakers.', true))).toBe(
      '## Why\n- AI spending worries hit chipmakers.',
    );
  });

  it("keeps a quote that follows a bullet's bold label", () => {
    expect(reply(text('- **Dow:** '), text('The Dow ended 0.34% lower.', true))).toBe('- **Dow:** The Dow ended 0.34% lower.');
  });

  it('keeps a reply made only of a quote', () => {
    expect(reply(text('Markets were closed for the holiday.', true))).toBe('Markets were closed for the holiday.');
  });
});
