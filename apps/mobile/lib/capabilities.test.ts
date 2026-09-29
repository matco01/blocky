import { describe, expect, it } from 'vitest';
import { isCapabilitiesQuestion } from './capabilities';

describe('asking for the menu, however it is phrased', () => {
  it.each([
    'what can you do',
    'What can you do?',
    'what can u do',
    'what else can you do?',
    'Blocky, what can you do for me?',
    'hey what can you do',
    'what do you do?',
    'what are your features',
    'show me what you can do',
    'help',
    'Help!',
  ])('%s', (text) => {
    expect(isCapabilitiesQuestion(text)).toBe(true);
  });
});

describe('real questions still go to Blocky', () => {
  it.each([
    'what can you do about my rent?',
    'can you help me pay Sam',
    'help me save for a trip',
    'what can I do with USDC?',
  ])('%s', (text) => {
    expect(isCapabilitiesQuestion(text)).toBe(false);
  });
});
