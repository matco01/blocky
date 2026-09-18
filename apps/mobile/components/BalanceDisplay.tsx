import { displayUsd } from '@blocky/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

export interface BalanceDisplayProps {
  /** Total balance as a USD decimal string. */
  totalUsd: string;
  loading?: boolean;
  /** Tap to refresh. */
  onPress?: () => void;
}

/**
 * The balance.
 *
 * One number, no token list, no network badge. Sized to share the screen with
 * the chat: still the first thing the eye lands on, but not the whole screen.
 *
 * Dollars and cents are split into separate weights so the eye lands on the
 * magnitude first.
 */
export function BalanceDisplay({ totalUsd, loading = false, onPress }: BalanceDisplayProps) {
  const formatted = displayUsd(totalUsd);
  const [dollars, cents] = formatted.split('.');
  const dim = loading ? { opacity: 0.3 } : undefined;

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.container}>
      <Text variant="label" tone="tertiary" style={styles.label}>
        Balance
      </Text>

      <View style={styles.amountRow} accessibilityRole="text" accessibilityLabel={`Balance ${formatted}`}>
        <Text variant="balance" style={[styles.dollars, dim]}>
          {dollars}
        </Text>
        <Text variant="balance" tone="tertiary" style={[styles.cents, dim]}>
          .{cents}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  dollars: {
    fontSize: 44,
    lineHeight: 52,
  },
  cents: {
    fontSize: 30,
    lineHeight: 52,
  },
});
