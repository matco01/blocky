import type { Plan, PolicyDecision } from '@blocky/shared';
import { StyleSheet, View } from 'react-native';
import { planAmountLabel, planArrivalLabel, planDestinationLabel, planFeeLabel, planFeeName, planVerb } from '../../lib/planLabels';
import { useTheme } from '../../theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { Tile } from '../Tile';

/**
 * A send the agent proposed, as a card in the chat.
 *
 * It never executes from here. The button opens the same confirmation screen a
 * manual send uses — one place where money is approved. A plan the user's
 * limits refuse shows why and has no button at all.
 *
 * When the policy engine says the plan is already inside the user's limits, the
 * button skips the review step and goes straight to the fingerprint. The card
 * above it is the review: amount, recipient, fee and any warnings are all here,
 * and the prompt names the amount again before anything is signed. What is
 * saved is a redundant tap, not the approval — the agent still cannot move
 * money on its own.
 */
export function ChatPlanCard({
  plan,
  decision,
  sent,
  onApprove,
}: {
  plan: Plan;
  decision: PolicyDecision | null;
  sent: boolean;
  /** `fast` skips the review step; it never skips the fingerprint. */
  onApprove: (fast: boolean) => void;
}) {
  const theme = useTheme();

  const amount = planAmountLabel(plan);
  const fee = planFeeLabel(plan);
  const verb = planVerb(plan);
  const denied = decision?.outcome === 'deny';
  const withinLimits = decision?.outcome === 'auto_execute';

  // `new_recipient` only restates the "Needs approval" status above. The full
  // review screen shows every warning; this card is the glance.
  const compactWarnings = plan.warnings.filter((warning) => warning.code !== 'new_recipient');

  const status = denied
    ? { label: 'Blocked', tone: 'warning' as const }
    : sent
      ? { label: verb === 'Move' ? 'On its way' : 'Sent', tone: 'positive' as const }
      : withinLimits
        ? { label: 'Within your limits', tone: 'secondary' as const }
        : { label: 'Needs approval', tone: 'tertiary' as const };

  return (
    <Tile style={{ padding: theme.space.lg }}>
      <View style={styles.header}>
        <Text variant="label" tone="secondary">
          {verb}
        </Text>
        <View style={styles.status}>
          {sent ? <Icon name="checkmark" size={14} tone="positive" /> : null}
          <Text variant="caption" tone={status.tone}>
            {status.label}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: theme.space.sm }}>
        <Text variant="title" tabular>
          {amount}
        </Text>
        <Text variant="body" tone="secondary">
          to {planDestinationLabel(plan)}
        </Text>
        {planArrivalLabel(plan) ? (
          <Text variant="caption" tone="tertiary">
            {planArrivalLabel(plan)}
          </Text>
        ) : null}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.border, marginVertical: theme.space.md }]} />

      <View style={styles.row}>
        <Text variant="caption" tone="tertiary">
          {planFeeName(plan)}
        </Text>
        <Text variant="caption" tabular>
          {fee}
        </Text>
      </View>

      {!denied && compactWarnings.length > 0 ? (
        <View style={{ gap: 4, marginTop: theme.space.sm }}>
          {compactWarnings.slice(0, 2).map((warning) => (
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
          <Button
            label={withinLimits ? `${verb} ${amount}` : `Review & ${verb.toLowerCase()}`}
            size="compact"
            haptic={withinLimits ? 'heavy' : 'medium'}
            onPress={() => onApprove(withinLimits)}
          />
        </View>
      ) : null}
    </Tile>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  divider: {
    height: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
