import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTheme } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Tone = 'primary' | 'secondary' | 'tertiary' | 'inverted' | 'accent' | 'brand' | 'positive' | 'warning' | 'danger';

const TONE_KEY = {
  primary: 'textPrimary',
  secondary: 'textSecondary',
  tertiary: 'textTertiary',
  inverted: 'textInverted',
  accent: 'accent',
  brand: 'brand',
  positive: 'positive',
  warning: 'warning',
  danger: 'danger',
} as const;

/** One icon family for the whole app, so stroke weight never varies between screens. */
export function Icon({ name, size = 20, tone = 'primary' }: { name: IconName; size?: number; tone?: Tone }) {
  const theme = useTheme();
  return <Ionicons name={name} size={size} color={theme.colors[TONE_KEY[tone]]} />;
}
