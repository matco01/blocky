import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { PressableScale, type PressableScaleProps } from './PressableScale';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  loading?: boolean;
  disabled?: boolean;
  /** `heavy` is for irreversible actions only — see PressableScale. */
  haptic?: PressableScaleProps['haptic'];
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

  const background =
    variant === 'primary' ? theme.colors.accent : variant === 'secondary' ? theme.colors.surface : 'transparent';
  const tone = variant === 'primary' ? 'inverted' : variant === 'quiet' ? 'secondary' : 'primary';

  return (
    <PressableScale
      onPress={onPress}
      // A loading button must not accept a second tap: that is how a send gets
      // submitted twice.
      disabled={disabled || loading}
      haptic={haptic}
      accessibilityLabel={label}
      style={[
        styles.button,
        size === 'compact' && styles.compact,
        { backgroundColor: background, borderRadius: size === 'compact' ? theme.radius.md : theme.radius.lg },
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? theme.colors.textInverted : theme.colors.textSecondary} />
        ) : (
          <Text variant="bodyStrong" tone={tone}>
            {label}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    justifyContent: 'center',
  },
  compact: {
    minHeight: 42,
  },
  inner: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
});
