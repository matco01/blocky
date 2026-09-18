import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type Theme } from '../theme';

type Variant = keyof Theme['type'];
type Tone = 'primary' | 'secondary' | 'tertiary' | 'inverted' | 'accent' | 'positive' | 'warning' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  /**
   * Fixed-width digits. On by default for the numeric variants, because a
   * balance whose digits change width as it animates looks broken.
   */
  tabular?: boolean;
}

/** Only the flat colour tokens — not grouped ones like `wood`. */
type ColorKey = { [K in keyof Theme['colors']]: Theme['colors'][K] extends string ? K : never }[keyof Theme['colors']];

const TONE_KEY: Record<Tone, ColorKey> = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  tertiary: 'textTertiary',
  inverted: 'textInverted',
  accent: 'accent',
  positive: 'positive',
  warning: 'warning',
  danger: 'danger',
};

export function Text({
  variant = 'body',
  tone = 'primary',
  tabular,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const typography = theme.type[variant];

  const useTabular = tabular ?? (variant === 'balance' || variant === 'title');

  const base: TextStyle = {
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    fontWeight: typography.fontWeight,
    color: theme.colors[TONE_KEY[tone]],
    ...(useTabular ? { fontVariant: ['tabular-nums'] as const } : null),
  };

  return <RNText {...rest} style={[base, style]} />;
}
