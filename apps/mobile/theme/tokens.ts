/**
 * Design tokens.
 *
 * The product's whole argument is that crypto can feel calm, so the palette is
 * deliberately quiet: near-black ground, one accent, and semantic colours used
 * sparingly enough that when something does turn amber the user looks at it.
 *
 * Every colour is defined for both schemes. Nothing reads a raw hex outside
 * this file — components take tokens, so a theme change is one edit here.
 */

export const palette = {
  // Neutrals. Warm-shifted rather than pure grey; pure grey reads clinical.
  black: '#0B0B0F',
  ink900: '#141419',
  ink800: '#1C1C23',
  ink700: '#26262F',
  ink600: '#3A3A46',
  ink500: '#5C5C6B',
  ink400: '#8E8E9E',
  ink300: '#B8B8C4',
  ink200: '#DCDCE4',
  ink100: '#EFEFF3',
  white: '#FFFFFF',

  // One accent. Restraint here is what keeps the balance screen calm.
  accent: '#5B5BD6',
  accentBright: '#7B7BF0',
  accentDim: '#3A3A9E',

  positive: '#2FA36B',
  positiveBright: '#4ECB8D',
  warning: '#D98324',
  warningBright: '#F0A050',
  danger: '#D64545',
  dangerBright: '#F06B6B',
} as const;

export interface ThemeColors {
  /** App background. */
  background: string;
  /** Raised surfaces: cards, sheets. */
  surface: string;
  /** Surfaces on top of surfaces: inputs, chips. */
  surfaceRaised: string;
  border: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Text on top of an accent fill. */
  textInverted: string;

  accent: string;
  accentText: string;

  positive: string;
  warning: string;
  danger: string;

  /** Scrims behind modals and sheets. */
  scrim: string;
}

const light: ThemeColors = {
  background: palette.white,
  surface: palette.ink100,
  surfaceRaised: palette.white,
  border: palette.ink200,

  textPrimary: palette.black,
  textSecondary: palette.ink500,
  textTertiary: palette.ink400,
  textInverted: palette.white,

  accent: palette.accent,
  accentText: palette.white,

  positive: palette.positive,
  warning: palette.warning,
  danger: palette.danger,

  scrim: 'rgba(11, 11, 15, 0.4)',
};

const dark: ThemeColors = {
  background: palette.black,
  surface: palette.ink900,
  surfaceRaised: palette.ink800,
  border: palette.ink700,

  textPrimary: palette.white,
  textSecondary: palette.ink300,
  textTertiary: palette.ink500,
  textInverted: palette.black,

  accent: palette.accentBright,
  accentText: palette.white,

  positive: palette.positiveBright,
  warning: palette.warningBright,
  danger: palette.dangerBright,

  scrim: 'rgba(0, 0, 0, 0.6)',
};

export const colorSchemes = { light, dark } as const;

/** 4pt base. Everything spatial is a multiple, no exceptions. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * `balance` is its own step and intentionally enormous — the balance is the
 * screen, and everything else is support. Tabular figures throughout so digits
 * don't shift width as an amount animates.
 */
export const type = {
  balance: { fontSize: 56, lineHeight: 62, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '500' },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '400' },
} as const;

/**
 * Motion.
 *
 * Short and slightly eased. Anything over ~250ms on a tap starts to feel like
 * the app is thinking, which is the opposite of the impression we want when
 * someone is moving money.
 */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  /** Standard ease-out curve for entrances and taps. */
  easing: [0.22, 1, 0.36, 1] as const,
} as const;
