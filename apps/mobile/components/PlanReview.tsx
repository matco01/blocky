import { displayUsd, parseUsd, type Plan } from '@blocky/shared';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

/**
 * The confirmation card.
 *
 * Every money-moving action renders exactly this: what leaves, where it goes,
 * the fee, and anything worth a second look. No exceptions, agent-initiated or
 * manual — the user learns one shape and can read it at a glance.
 *
 * Everything here comes from the server's plan, never from what the user typed.
 * If they typed "10" and the plan says 1,000, the card shows 1,000.
 *
 * The fee is one number in dollars. Gas is never broken out and never a
 * decision.
 */
export function PlanReview({ plan, secondsLeft }: { plan: Plan; secondsLeft: number }) {
  const theme = useTheme();

  const outflow = plan.outflow[0];
  const fee = parseUsd(plan.fee.totalUsd) === 0n ? 'Free' : displayUsd(plan.fee.totalUsd);

  return (
    <View style={{ gap: theme.space.xl }}>
      <View style={styles.hero}>
        <Text variant="label" tone="tertiary">
          You're sending
        </Text>
        <Text variant="balance" style={styles.amount}>
          {outflow?.usdValue ? displayUsd(outflow.usdValue) : `${outflow?.displayAmount} ${outflow?.token.symbol}`}
        </Text>
        <Text variant="body" tone="secondary">
          to {plan.recipient?.display ?? 'yourself'}
        </Text>
      </View>

      <View
        style={[
          styles.details,
          { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.space.lg },
        ]}
      >
        <Row label="Amount" value={`${outflow?.displayAmount ?? '0'} ${outflow?.token.symbol ?? ''}`} />
        <Row label="Network fee" value={fee} />
        {plan.recipient && plan.recipient.display !== plan.recipient.address ? (
          <Row label="Address" value={`${plan.recipient.address.slice(0, 10)}…${plan.recipient.address.slice(-8)}`} />
        ) : null}
      </View>

      {plan.warnings.length > 0 ? (
        <View style={{ gap: theme.space.sm }}>
          {plan.warnings.map((warning) => (
            <View
              key={warning.code}
              style={[
                styles.warning,
                {
                  borderRadius: theme.radius.md,
                  padding: theme.space.md,
                  backgroundColor: theme.colors.surface,
                  borderLeftColor: warning.severity === 'danger' ? theme.colors.danger : theme.colors.warning,
                },
              ]}
            >
              <Text variant="caption" tone={warning.severity === 'danger' ? 'danger' : 'secondary'}>
                {warning.message}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text variant="caption" tone={secondsLeft <= 10 ? 'warning' : 'tertiary'} style={styles.expiry}>
        {secondsLeft > 0 ? `Price held for ${secondsLeft}s` : 'This quote expired'}
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong" tabular>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: 4,
  },
  amount: {
    marginVertical: 4,
  },
  details: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  warning: {
    borderLeftWidth: 3,
  },
  expiry: {
    textAlign: 'center',
  },
});
