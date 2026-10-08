import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type Theme } from '../theme';

type Variant = keyof Theme['type'];
type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'inverted'
  | 'accent'
  | 'brand'
  | 'positive'
  | 'warning'
  | 'danger';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  /** Fixed-width digits. On by default for the numeric variants. */
  tabular?: boolean;
}

const TONE_KEY: Record<Tone, keyof Theme['colors']> = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  tertiary: 'textTertiary',
  inverted: 'textInverted',
  accent: 'accent',
  brand: 'brand',
  positive: 'positive',
  warning: 'warning',
  danger: 'danger',
};

export function Text({ variant = 'body', tone = 'primary', tabular, style, ...rest }: TextProps) {
  const theme = useTheme();
  const typography = theme.type[variant];
  const useTabular = tabular ?? (variant === 'balance' || variant === 'title' || variant === 'display');

  const base: TextStyle = {
    fontFamily: typography.family,
    // The weight lives in the font file. Android must not synthesise bold on top.
    fontWeight: 'normal',
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    letterSpacing: typography.letterSpacing,
    color: theme.colors[TONE_KEY[tone]],
    // Android pads ascenders/descenders by default, which floats labels in blocks.
    ...Platform.select({ android: { includeFontPadding: false as const } }),
    ...(useTabular ? { fontVariant: ['tabular-nums'] as const } : null),
  };

  return <RNText {...rest} style={[base, style]} />;
}
