import { shortAddress, type Plan } from '@blocky/shared';
import { getChain } from '@blocky/wallet-core';
import { StyleSheet, View } from 'react-native';
import { planAmountLabel, planDestinationLabel, planFeeLabel, planFeeName, planVerb } from '../lib/planLabels';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { Tile } from './Tile';

/**
 * The confirmation card.
 *
 * Every money-moving action renders exactly this: what leaves, where it goes,
 * the fee, and anything worth a second look. Everything comes from the server's
 * plan, never from what the user typed. The fee is one number in dollars; gas
 * is never broken out and never a decision.
 */
export function PlanReview({ plan, secondsLeft }: { plan: Plan; secondsLeft: number }) {
  const theme = useTheme();

  const outflow = plan.outflow[0];
  const landing = plan.intentType === 'bridge' ? plan.inflow[0] : undefined;
  const fee = planFeeLabel(plan);

  return (
    <View style={{ gap: theme.space.xl }}>
      <View style={styles.hero}>
        <Text variant="label" tone="secondary">
          {planVerb(plan) === 'Move' ? "You're moving" : "You're sending"}
        </Text>
        <Text variant="balance">
          {planAmountLabel(plan)}
        </Text>
        <Text variant="body" tone="secondary">
          to {planDestinationLabel(plan)}
        </Text>
      </View>

      <Tile style={{ padding: theme.space.lg, gap: 14 }}>
        <Row label="Amount" value={`${outflow?.displayAmount ?? '0'} ${outflow?.token.symbol ?? ''}`} />
        <Row label={planFeeName(plan)} value={fee} />
        {landing ? (
          <Row label="Arrives on" value={`${getChain(landing.token.chainId).name}, in about a minute`} />
        ) : null}
        {plan.recipient && plan.recipient.display !== plan.recipient.address ? (
          <Row label="Address" value={shortAddress(plan.recipient.address, 10, 8)} />
        ) : null}
      </Tile>

      {plan.warnings.length > 0 ? (
        <View style={{ gap: theme.space.sm }}>
          {plan.warnings.map((warning) => {
            const danger = warning.severity === 'danger';
            return (
              <Tile key={warning.code} tint={danger ? 'danger' : 'warning'} radius={theme.radius.md} style={styles.warning}>
                <Icon name="alert-circle-outline" size={18} tone={danger ? 'danger' : 'warning'} />
                <Text variant="caption" tone={danger ? 'danger' : 'warning'} style={{ flex: 1 }}>
                  {warning.message}
                </Text>
              </Tile>
            );
          })}
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  expiry: {
    textAlign: 'center',
  },
});
