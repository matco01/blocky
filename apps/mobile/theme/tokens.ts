/**
 * Design tokens — the Block system.
 *
 * Everything is a tile or a block. Tiles are flat surfaces with a stroke (2 px
 * in light, 1 px in dark — a 2 px light outline on near-black reads as a
 * wireframe); there are no drop shadows, the stroke is the depth cue. Blocks
 * are the tappable things: rounded squares with a darker bottom edge that
 * collapses when pressed. The edge is only ever on something tappable.
 *
 * Colour roles: green is the action, maroon is the identity, red is danger.
 * The mascot gives us both brand colours — `#723431` is its body, and the leaf
 * green is a fresher descendant of its olive leaf (the olive is too dour as a
 * fill). A maroon button next to green money-in and red errors reads, to
 * someone new to all this, as a dark red warning; so maroon carries the
 * wordmark, the card and the user's own chat bubbles, never a primary action.
 *
 * Contrast (WCAG relative luminance): primary text ≥ 13 : 1 on every fill;
 * secondary ≥ 4.9 : 1; tertiary ≈ 4 : 1, captions and placeholders only; every
 * label-on-action pair ≥ 5 : 1; every callout colour on its own tint ≥ 4.5 : 1.
 *
 * Nothing reads a raw hex outside this file. `app.json`'s
 * `adaptiveIcon.backgroundColor` predates this palette; changing it needs a
 * native rebuild, so it waits for the next one.
 */

export const palette = {
  // Maroon — the mascot's body (#723431 is sampled from the artwork).
  maroon900: '#4A1F1D',
  maroon700: '#723431',
  maroon600: '#8B4441',
  maroonBright: '#CC7B76',
  maroon100: '#F6E6E4',
  maroon850: '#3A2624',

  // Leaf — the action green, darkened until a white label clears 4.5 : 1.
  leaf800: '#285A1C',
  leaf700: '#367526',
  leaf100: '#E6F2DF',
  leafBright: '#7DBE5A',
  leafBrightEdge: '#5A9440',
  leafText: '#9CB36B',
  leaf850: '#243120',

  amber700: '#9A5A0C',
  amber100: '#FBEFD9',
  amberBright: '#E8A94A',
  amber850: '#3A2E1C',

  red700: '#B3261E',
  red100: '#FBE4E1',
  redBright: '#F2826F',
  red850: '#3B2220',

  // Warm neutrals — light scheme type and strokes.
  ink900: '#2B1F1A',
  ink600: '#6E6058',
  ink500: '#857569',
  stone300: '#CFC3B7',
  stone200: '#E6DDD3',
  stone100: '#F6F0E9',
  paper: '#FFFCF8',
  white: '#FFFFFF',

  // Night — dark scheme ground and surfaces.
  night950: '#0E1512',
  night900: '#121816',
  night850: '#1B2320',
  night800: '#242D29',
  night700: '#34403A',
  night600: '#46554D',
  mist100: '#F6F0EA',
  mist300: '#C3B9B0',
  mist500: '#968D85',
} as const;

export interface ThemeColors {
  background: string;
  /** Tiles: cards, inputs, the speech bubble. */
  surface: string;
  /** Quieter tiles: chips, icon squares, an idle input. */
  surfaceMuted: string;
  /** The stroke around a tile. */
  border: string;
  /** The edge under a secondary block. */
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Text on an accent fill. */
  textInverted: string;

  /** The action colour: primary blocks, the send button, links. */
  accent: string;
  accentEdge: string;
  /** Soft accent fill: success callouts, the Sent square. */
  accentTint: string;
  accentText: string;

  /** The identity colour: wordmark, active page dot. Never a button. */
  brand: string;
  /** The user's own chat bubbles. */
  brandTint: string;

  /** Money coming in. Text and tint only. */
  positive: string;
  positiveTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;

  scrim: string;
}

const light: ThemeColors = {
  background: palette.paper,
  surface: palette.white,
  surfaceMuted: palette.stone100,
  border: palette.stone200,
  borderStrong: palette.stone300,

  textPrimary: palette.ink900,
  textSecondary: palette.ink600,
  textTertiary: palette.ink500,
  textInverted: palette.white,

  accent: palette.leaf700,
  accentEdge: palette.leaf800,
  accentTint: palette.leaf100,
  accentText: palette.white,

  brand: palette.maroon700,
  brandTint: palette.maroon100,

  positive: palette.leaf700,
  positiveTint: palette.leaf100,
  warning: palette.amber700,
  warningTint: palette.amber100,
  danger: palette.red700,
  dangerTint: palette.red100,

  scrim: 'rgba(43, 31, 26, 0.45)',
};

const dark: ThemeColors = {
  background: palette.night900,
  surface: palette.night850,
  surfaceMuted: palette.night800,
  border: palette.night700,
  borderStrong: palette.night600,

  textPrimary: palette.mist100,
  textSecondary: palette.mist300,
  textTertiary: palette.mist500,
  // The bright leaf is light, so the label on it is dark.
  textInverted: palette.night950,

  accent: palette.leafBright,
  accentEdge: palette.leafBrightEdge,
  accentTint: palette.leaf850,
  accentText: palette.night950,

  brand: palette.maroonBright,
  brandTint: palette.maroon850,

  positive: palette.leafText,
  positiveTint: palette.leaf850,
  warning: palette.amberBright,
  warningTint: palette.amber850,
  danger: palette.redBright,
  dangerTint: palette.red850,

  scrim: 'rgba(0, 0, 0, 0.6)',
};

export const colorSchemes = { light, dark } as const;

/** Stroke width around a tile, per scheme. */
export const strokes = { light: 2, dark: 1 } as const;

/** Height of the edge under a block. */
export const EDGE = 4;

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

/** Rounded squares. `pill` is for the page dots and nothing tappable. */
export const radius = {
  sm: 8,
  md: 12,
  /** Blocks. */
  lg: 16,
  /** Tiles. */
  xl: 20,
  /** The QR tile, sheets. */
  xxl: 28,
  pill: 999,
} as const;

/** Figtree, loaded in `app/_layout.tsx`. One face for the whole app. */
export const font = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  extrabold: 'Figtree_800ExtraBold',
} as const;

/**
 * Type scale. `balance` is the biggest thing on Home and everything else is
 * support. Tabular figures on amounts so digits don't shift as a number animates.
 */
export const type = {
  balance: { family: font.extrabold, fontSize: 44, lineHeight: 52 },
  title: { family: font.extrabold, fontSize: 30, lineHeight: 36 },
  heading: { family: font.bold, fontSize: 22, lineHeight: 28 },
  body: { family: font.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { family: font.semibold, fontSize: 16, lineHeight: 24 },
  label: { family: font.semibold, fontSize: 14, lineHeight: 20 },
  caption: { family: font.medium, fontSize: 13, lineHeight: 18 },
} as const;

/**
 * Motion. Short and slightly eased. Anything over ~250ms on a tap starts to
 * feel like the app is thinking — the opposite of what someone moving money wants.
 */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  easing: [0.22, 1, 0.36, 1] as const,
} as const;
