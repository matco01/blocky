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
 * The balance. One number, no token list, no network badge. Dollars and cents
 * at one size, cents in a lighter tone so the eye lands on the magnitude first.
 */
export function BalanceDisplay({ totalUsd, loading = false, onPress }: BalanceDisplayProps) {
  const formatted = displayUsd(totalUsd);
  const [dollars, cents] = formatted.split('.');
  const dim = loading ? { opacity: 0.3 } : undefined;

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.container}>
      <Text variant="caption" tone="secondary">
        Balance
      </Text>
      <View style={styles.amountRow} accessibilityRole="text" accessibilityLabel={`Balance ${formatted}`}>
        <Text variant="balance" style={dim}>
          {dollars}
        </Text>
        <Text variant="balance" tone="tertiary" style={dim}>
          .{cents}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  amountRow: {
    flexDirection: 'row',
  },
});
