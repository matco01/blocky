import { shortAddress, type Plan } from '@blocky/shared';
import { Platform, StyleSheet, View } from 'react-native';
import {
  planAmountLabel,
  planArrivalLabel,
  planBlockyFeeLabel,
  planDestinationLabel,
  planFeeLabel,
  planFeeName,
  planGasTopUpLabel,
  planGasTopUpReason,
  planVerb,
} from '../lib/planLabels';
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
  const arrival = planArrivalLabel(plan);
  const fee = planFeeLabel(plan);
  const lookalike = plan.warnings.find((warning) => warning.code === 'address_lookalike');

  return (
    <View style={{ gap: theme.space.xl }}>
      <View style={styles.hero}>
        <Text variant="label" tone="secondary">
          {
            {
              Move: "You're moving",
              Swap: "You're swapping",
              Buy: "You're buying",
              Sell: "You're selling",
              Send: "You're sending",
            }[planVerb(plan)]
          }
        </Text>
        <Text variant="balance">
          {planAmountLabel(plan)}
        </Text>
        <Text variant="body" tone="secondary">
          {planDestinationLabel(plan)}
        </Text>
      </View>

      <Tile style={{ padding: theme.space.lg, gap: 14 }}>
        <Row label="Amount" value={`${outflow?.displayAmount ?? '0'} ${outflow?.token.symbol ?? ''}`} />
        <Row label={planFeeName(plan)} value={fee} />
        {planBlockyFeeLabel(plan) ? <Row label="Includes Blocky's fee" value={planBlockyFeeLabel(plan)!} /> : null}
        {arrival ? <Row label="Arrives" value={arrival} /> : null}
        {planGasTopUpLabel(plan) ? <Row label="Gas" value={planGasTopUpLabel(plan)!.replace(/^\+ /, '')} /> : null}
        {planGasTopUpReason(plan) ? (
          <Text variant="caption" tone="tertiary">
            {planGasTopUpReason(plan)}
          </Text>
        ) : null}
        {plan.recipient && plan.recipient.display !== plan.recipient.address && !lookalike ? (
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
                <View style={{ flex: 1, gap: 10 }}>
                  <Text variant="caption" tone={danger ? 'danger' : 'warning'}>
                    {warning.message}
                  </Text>
                  {warning.code === 'address_lookalike' && warning.lookalikeOf && plan.recipient ? (
                    <>
                      <AddressDiff label="You're sending to" address={plan.recipient.address} other={warning.lookalikeOf} />
                      <AddressDiff label="The one you know" address={warning.lookalikeOf} other={plan.recipient.address} />
                    </>
                  ) : null}
                </View>
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

/**
 * A whole address, every character, with the ones that differ from `other`
 * marked — poisoned addresses match at both ends, so the middle is the tell.
 */
function AddressDiff({ label, address, other }: { label: string; address: string; other: string }) {
  const theme = useTheme();
  const a = address.toLowerCase();
  const b = other.toLowerCase();

  // Runs of same/different characters, so the text isn't 42 separate spans.
  const runs: Array<{ text: string; differs: boolean }> = [];
  for (let i = 0; i < address.length; i++) {
    const differs = a[i] !== b[i];
    const last = runs[runs.length - 1];
    if (last && last.differs === differs) last.text += address[i];
    else runs.push({ text: address[i]!, differs });
  }

  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="caption" tabular style={styles.address}>
        {runs.map((run, i) =>
          run.differs ? (
            <Text key={i} variant="caption" style={[styles.address, styles.differs, { color: theme.colors.danger }]}>
              {run.text}
            </Text>
          ) : (
            run.text
          ),
        )}
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
  address: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    letterSpacing: 0.5,
  },
  differs: {
    textDecorationLine: 'underline',
    fontWeight: 'bold',
  },
  expiry: {
    textAlign: 'center',
  },
});
