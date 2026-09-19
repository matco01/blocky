import { ActivityIndicator } from 'react-native';
import { useTheme } from '../theme';
import { BlockPressable, type BlockPressableProps } from './BlockPressable';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /** `danger` is for signing out and the like: a plain block with a red label. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  haptic?: BlockPressableProps['haptic'];
  /** `compact` for buttons inside cards. */
  size?: 'regular' | 'compact';
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  haptic = 'light',
  size = 'regular',
}: ButtonProps) {
  const theme = useTheme();
  // A loading button must not accept a second tap: that is how a send gets submitted twice.
  const blocked = disabled || loading;

  if (variant === 'quiet') {
    return (
      <PressableScale onPress={onPress} disabled={blocked} haptic={haptic} accessibilityLabel={label} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
        {loading ? (
          <ActivityIndicator color={theme.colors.textSecondary} />
        ) : (
          <Text variant="bodyStrong" tone="secondary">
            {label}
          </Text>
        )}
      </PressableScale>
    );
  }

  const primary = variant === 'primary';
  const tone = primary ? 'inverted' : variant === 'danger' ? 'danger' : 'primary';

  return (
    <BlockPressable
      onPress={onPress}
      disabled={blocked}
      haptic={haptic}
      accessibilityLabel={label}
      height={size === 'compact' ? 44 : 56}
      radius={size === 'compact' ? theme.radius.md : theme.radius.lg}
      fill={primary ? theme.colors.accent : theme.colors.surface}
      edge={primary ? theme.colors.accentEdge : theme.colors.borderStrong}
      stroke={primary ? undefined : theme.colors.border}
    >
      {loading ? (
        <ActivityIndicator color={primary ? theme.colors.accentText : theme.colors.textSecondary} />
      ) : (
        <Text variant="bodyStrong" tone={tone} style={{ paddingHorizontal: 20 }}>
          {label}
        </Text>
      )}
    </BlockPressable>
  );
}
