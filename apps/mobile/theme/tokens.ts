/**
 * Design tokens — anchored to the mascot.
 *
 * The brand colours are sampled from the mascot artwork itself (assets/blocky*.jpg),
 * not chosen separately: `maroon700` (#723431) is its body, `sprout500` (#6C7942)
 * is its leaf. Everything else — the fills used for buttons and text — is a
 * darkened or lightened derivative of those two, checked for contrast, so the
 * mascot never looks like it wandered in from a different app.
 *
 * Light-first: a warm cream page, deep sprout green for the primary action,
 * the mascot's maroon for the secondary one (Send), warm taupe for quiet text.
 * Dark keeps the same maroon and a brightened sprout, on a near-black ground.
 *
 * A direction being tried, not a final brand. Nothing reads a raw hex outside
 * this file, so trying another one is an edit here and nowhere else.
 *
 * Contrast: every text-on-fill pair below was checked at ≥ 4.5 : 1 (most sit
 * well above 6.8 : 1). Tertiary text sits at ~4 : 1 and is only used for
 * captions and placeholders.
 */

export const palette = {
  // Maroon — the mascot's body. #723431 is sampled directly from the artwork.
  maroon900: '#331716',
  maroon700: '#723431',
  maroon600: '#8B4441',
  maroon100: '#F3E1DE',

  // Sprout — the mascot's leaf. #6C7942 is sampled directly from the artwork;
  // the others are it darkened (for light-mode fills) and brightened (for dark).
  sprout700: '#4C552E',
  sprout500: '#6C7942',
  sproutBright: '#9CB36B',

  // Amber — warning only. Not a brand colour.
  amber700: '#8A5410',
  amberBright: '#E8A94A',

  // Taupe — warm neutrals for type on the light ground.
  taupe900: '#2B211B',
  taupe600: '#6C5E53',
  taupe500: '#8A7A6D',

  // Cream — the light ground.
  cream50: '#FFFBF8',
  cream100: '#FFF6EF',
  cream200: '#FCEBDF',
  cream300: '#F6E0D2',
  cream400: '#EDD8CA',

  // Night — the dark ground: near-black, with surfaces clearly lifted off it
  // so cards read as cards.
  night950: '#0E1512',
  night900: '#18221D',
  night850: '#1F2B25',
  night800: '#25332C',
  night700: '#324239',
  mist300: '#C4BCB4',
  mist500: '#8C837B',

  // Errors.
  error: '#B3261E',
  errorBright: '#F2826F',

  white: '#FFFFFF',
} as const;

export interface ThemeColors {
  /** App background. */
  background: string;
  /** Raised surfaces: cards, sheets. */
  surface: string;
  /** Surfaces on top of surfaces: inputs, chips. */
  surfaceRaised: string;
  /** The user's own chat messages: quiet, visible in both schemes. */
  bubble: string;
  border: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Text on top of an accent fill. */
  textInverted: string;

  /** Primary actions — the mascot's sprout, darkened or brightened for contrast. */
  accent: string;
  accentText: string;

  /** The mascot's maroon, for a second kind of action (e.g. Send). */
  secondary: string;
  secondaryText: string;

  /** Reuses `accent`: the sprout already means growth, so success doesn't need its own hue. */
  positive: string;
  warning: string;
  danger: string;

  /** Scrims behind modals and sheets. */
  scrim: string;
}

/** Cream, sprout and maroon: the scheme the brand is designed in. */
const light: ThemeColors = {
  background: palette.cream100,
  surface: palette.cream200,
  surfaceRaised: palette.cream50,
  bubble: palette.cream300,
  border: palette.cream400,

  textPrimary: palette.taupe900,
  textSecondary: palette.taupe600,
  textTertiary: palette.taupe500,
  textInverted: palette.cream50,

  accent: palette.sprout700,
  accentText: palette.cream50,

  secondary: palette.maroon700,
  secondaryText: palette.cream50,

  positive: palette.sprout700,
  warning: palette.amber700,
  danger: palette.error,

  scrim: 'rgba(43, 33, 27, 0.4)',
};

/** The same mascot at night: near-black ground, cream type, a brighter sprout. */
const dark: ThemeColors = {
  background: palette.night950,
  surface: palette.night900,
  surfaceRaised: palette.night850,
  bubble: palette.night800,
  border: palette.night700,

  textPrimary: palette.cream100,
  textSecondary: palette.mist300,
  textTertiary: palette.mist500,
  // The bright sprout is light, so the type on it is dark, not white.
  textInverted: palette.night950,

  accent: palette.sproutBright,
  accentText: palette.night950,

  secondary: palette.maroon600,
  secondaryText: palette.cream50,

  positive: palette.sproutBright,
  warning: palette.amberBright,
  danger: palette.errorBright,

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
