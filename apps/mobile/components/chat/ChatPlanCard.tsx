import { displayUsd, parseUsd, type Plan, type PolicyDecision } from '@blocky/shared';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { Button } from '../Button';
import { Text } from '../Text';

/**
 * A send the agent proposed, as a transaction card in the chat.
 *
 * It never executes from here. "Review & send" opens the same confirmation
 * screen as a manual send — one place where money is approved, with the full
 * details and the fingerprint prompt. A plan the user's limits refuse shows why
 * and has no button at all.
 */
export function ChatPlanCard({
  plan,
  decision,
  sent,
  onReview,
}: {
  plan: Plan;
  decision: PolicyDecision | null;
  sent: boolean;
  onReview: () => void;
}) {
  const theme = useTheme();

  const outflow = plan.outflow[0];
  const amount = outflow?.usdValue ? displayUsd(outflow.usdValue) : `${outflow?.displayAmount} ${outflow?.token.symbol}`;
  const fee = parseUsd(plan.fee.totalUsd) === 0n ? 'Free' : displayUsd(plan.fee.totalUsd);
  const denied = decision?.outcome === 'deny';

  const status = denied
    ? { label: 'Blocked', tone: 'warning' as const }
    : sent
      ? { label: 'Sent', tone: 'positive' as const }
      : { label: 'Needs approval', tone: 'tertiary' as const };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          padding: theme.space.lg,
        },
      ]}
    >
      <View style={styles.header}>
        <Text variant="label" tone="tertiary" style={styles.eyebrow}>
          Send
        </Text>
        <Text variant="caption" tone={status.tone}>
          {sent ? '✓ ' : ''}
          {status.label}
        </Text>
      </View>

      <View style={{ marginTop: theme.space.sm }}>
        <Text variant="title" tabular>
          {amount}
        </Text>
        <Text variant="body" tone="secondary">
          to {plan.recipient?.display ?? 'yourself'}
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.border, marginVertical: theme.space.md }]} />

      <View style={styles.row}>
        <Text variant="caption" tone="tertiary">
          Network fee
        </Text>
        <Text variant="caption" tabular>
          {fee}
        </Text>
      </View>

      {!denied && plan.warnings.length > 0 ? (
        <View style={{ gap: 4, marginTop: theme.space.sm }}>
          {plan.warnings.slice(0, 2).map((warning) => (
            <Text key={warning.code} variant="caption" tone={warning.severity === 'danger' ? 'danger' : 'secondary'}>
              {warning.message}
            </Text>
          ))}
        </View>
      ) : null}

      {denied ? (
        <View style={{ gap: 4, marginTop: theme.space.sm }}>
          {decision.reasons.map((reason) => (
            <Text key={reason.code} variant="caption" tone="warning">
              {reason.message}
            </Text>
          ))}
        </View>
      ) : null}

      {!denied && !sent ? (
        <View style={{ marginTop: theme.space.lg }}>
          <Button label="Review & send" size="compact" haptic="medium" onPress={onReview} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
