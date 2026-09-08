import { displayUsd } from '@blocky/shared';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

export interface BalanceDisplayProps {
  /** Total balance as a USD decimal string. */
  totalUsd: string;
  loading?: boolean;
}

/**
 * The balance. This is the screen.
 *
 * One number, chain-agnostic, no token list, no network badge. Circle Gateway
 * is what makes that honest rather than a simplification — the USDC really is
 * spendable on any supported chain, so there is nothing to disclose here.
 *
 * The dollars and cents are split into separate weights so the eye lands on the
 * magnitude first. It reads as one number and scans as one number.
 */
export function BalanceDisplay({ totalUsd, loading = false }: BalanceDisplayProps) {
  const theme = useTheme();

  const formatted = displayUsd(totalUsd);
  const [dollars, cents] = formatted.split('.');

  return (
    <View style={styles.container}>
      <Text variant="label" tone="tertiary" style={styles.label}>
        Balance
      </Text>

      <View style={styles.amountRow} accessibilityRole="text" accessibilityLabel={`Balance ${formatted}`}>
        <Text variant="balance" style={loading ? { opacity: 0.3 } : undefined}>
          {dollars}
        </Text>
        <Text
          variant="balance"
          tone="tertiary"
          style={[styles.cents, loading ? { opacity: 0.3 } : undefined]}
        >
          .{cents}
        </Text>
      </View>

      <Text variant="caption" tone="tertiary" style={{ marginTop: theme.space.xs }}>
        Available everywhere
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  cents: {
    // Slightly smaller so the cents recede without breaking the baseline.
    fontSize: 40,
  },
});
