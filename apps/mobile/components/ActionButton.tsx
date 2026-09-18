import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ActionButtonProps {
  label: string;
  /** A glyph. Kept as text so it needs no icon dependency. */
  glyph: string;
  onPress?: () => void;
  /** `accent` and `secondary` are the brand's two action colours; `plain` is quiet. */
  fill?: 'accent' | 'secondary' | 'plain';
  disabled?: boolean;
}

/**
 * Receive, Send, Activity — compact pills under the balance.
 *
 * Small on purpose: the chat is the main surface, and these are shortcuts for
 * the things that are faster to tap than to type.
 */
export function ActionButton({ label, glyph, onPress, fill = 'plain', disabled }: ActionButtonProps) {
  const theme = useTheme();

  const background =
    fill === 'accent' ? theme.colors.accent : fill === 'secondary' ? theme.colors.secondary : theme.colors.surface;
  const color =
    fill === 'accent' ? theme.colors.accentText : fill === 'secondary' ? theme.colors.secondaryText : theme.colors.textPrimary;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      haptic="light"
      style={[styles.pill, { backgroundColor: background, borderRadius: theme.radius.pill }]}
    >
      <View style={styles.inner}>
        <Text variant="bodyStrong" style={{ color }}>
          {glyph}
        </Text>
        <Text variant="label" style={{ color }}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
