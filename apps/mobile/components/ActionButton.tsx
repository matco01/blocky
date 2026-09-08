import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ActionButtonProps {
  label: string;
  /** A glyph. Kept as text so M0 ships without an icon dependency. */
  glyph: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

/**
 * Receive and Send.
 *
 * These stay manual on purpose. The agent is better at everything complicated,
 * but "send money to someone" is two taps and no sentence you could type would
 * be faster. Putting them on the home screen is a UX decision, not a fallback.
 */
export function ActionButton({
  label,
  glyph,
  onPress,
  variant = 'secondary',
  disabled,
}: ActionButtonProps) {
  const theme = useTheme();

  const isPrimary = variant === 'primary';

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      haptic="medium"
      style={[
        styles.button,
        {
          backgroundColor: isPrimary ? theme.colors.accent : theme.colors.surface,
          borderRadius: theme.radius.lg,
          paddingVertical: theme.space.lg,
          gap: theme.space.xs,
        },
      ]}
    >
      <View style={styles.inner}>
        <Text variant="heading" tone={isPrimary ? 'inverted' : 'primary'}>
          {glyph}
        </Text>
        <Text variant="label" tone={isPrimary ? 'inverted' : 'primary'}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
  },
  inner: {
    alignItems: 'center',
    gap: 4,
  },
});
