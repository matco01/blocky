import { describe, expect, it } from 'vitest';
import { matchAppearanceCommand, resolveAppearance } from './appearanceCommand';

/**
 * The inversion is the whole point of this matcher: "turn off dark mode" and
 * "turn on dark mode" are opposite commands that share every word except one.
 * Get that backwards and every "turn off dark mode" silently turns dark mode
 * *on* instead — worth pinning explicitly, not just trusting the symmetry.
 */

describe('turning dark mode on lands on dark', () => {
  it.each([
    'turn on dark mode',
    'turn dark mode on',
    'enable dark mode',
    'activate dark mode',
    'dark mode on',
    'switch to dark mode',
    'switch to dark',
    'go dark',
    'make it dark',
    'dark theme please',
  ])('%s', (text) => {
    expect(matchAppearanceCommand(text)).toBe('dark');
  });
});

describe('turning dark mode off lands on light — the inversion', () => {
  it.each(['turn off dark mode', 'turn dark mode off', 'disable dark mode', 'deactivate dark mode', 'dark mode off'])(
    '%s',
    (text) => {
      expect(matchAppearanceCommand(text)).toBe('light');
    },
  );
});

describe('turning light mode on lands on light', () => {
  it.each(['turn on light mode', 'enable light mode', 'light mode on', 'switch to light mode', 'go light', 'make it light'])(
    '%s',
    (text) => {
      expect(matchAppearanceCommand(text)).toBe('light');
    },
  );
});

describe('turning light mode off lands on dark — the inversion, the other way', () => {
  it.each(['turn off light mode', 'disable light mode', 'light mode off'])('%s', (text) => {
    expect(matchAppearanceCommand(text)).toBe('dark');
  });
});

describe('toggle, without saying which way', () => {
  it.each(['toggle dark mode', 'toggle light mode', 'toggle the theme', 'switch the theme', 'toggle appearance'])(
    '%s',
    (text) => {
      expect(matchAppearanceCommand(text)).toBe('toggle');
    },
  );
});

describe('a real question is not a command', () => {
  it.each(['is dark mode available?', "what's dark mode?", 'does this app have a light mode?'])('%s', (text) => {
    expect(matchAppearanceCommand(text)).toBeNull();
  });

  it('still treats a politely-phrased command as a command despite the "?"', () => {
    expect(matchAppearanceCommand('can you turn on dark mode?')).toBe('dark');
  });
});

describe('genuinely ambiguous input is left alone', () => {
  it.each(['switch between light and dark', 'dark and light mode'])('%s', (text) => {
    expect(matchAppearanceCommand(text)).toBeNull();
  });
});

describe('plain wallet requests that happen to contain "on" or "off"', () => {
  it.each([
    "what's my balance?",
    'send $20 to sam on tuesday',
    'turn off my spending limit', // no dark/light word at all
    "what's live on arc right now?",
    'switch my recipient to sam',
  ])('%s', (text) => {
    expect(matchAppearanceCommand(text)).toBeNull();
  });
});

describe('resolveAppearance', () => {
  it('toggles to the other appearance', () => {
    expect(resolveAppearance('toggle', 'dark')).toBe('light');
    expect(resolveAppearance('toggle', 'light')).toBe('dark');
  });

  it('an explicit target wins whatever is showing', () => {
    expect(resolveAppearance('dark', 'dark')).toBe('dark');
    expect(resolveAppearance('light', 'dark')).toBe('light');
  });
});
