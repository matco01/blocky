import { isPlanExpired, type Plan } from '@blocky/shared';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { Tile } from '../components/Tile';
import { api } from '../lib/api';
import { confirmWithBiometrics } from '../lib/biometrics';
import { getHandedOffPlan, markPlanSent } from '../lib/handoff';
import { planAmountLabel, planArrivalLabel, planDestinationLabel, planFeeLabel, planGasTopUpLabel, planVerb } from '../lib/planLabels';
import { reportWithRetry } from '../lib/report';
import { useModalTopPadding } from '../lib/screenInsets';
import { SubmittedButUnconfirmedError, useWallet } from '../lib/wallet';
import { useTheme } from '../theme';

type Status =
  | { name: 'waiting' }
  | { name: 'sending' }
  | { name: 'sent'; recorded: boolean }
  /** Nothing reached the chain. */
  | { name: 'failed'; message: string }
  /** Submitted, outcome unknown — never offered again from here. */
  | { name: 'unconfirmed' };

interface Item {
  /** The id the chat card knows it by — kept when a stale quote is refreshed. */
  cardId: string;
  plan: Plan;
  status: Status;
}

/**
 * Approve several proposals at once: "bring everything home" across three
 * chains is one review and one fingerprint, not three trips through Send.
 *
 * The fingerprint prompt names every one of them, and each still goes out as
 * exactly its own plan — its own transactions, verified by the server on its
 * own. They are independent moves, so one failing doesn't stop the rest; the
 * screen says which went and which didn't, and never offers to resend one
 * whose outcome is unknown.
 */
export default function SendAllScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { sendCalls, ready } = useWallet();

  const { planIds } = useLocalSearchParams<{ planIds?: string }>();
  const [items, setItems] = useState<Item[]>(() =>
    (planIds ?? '')
      .split(',')
      .map((id) => getHandedOffPlan(id))
      .filter((plan): plan is Plan => plan !== null)
      .map((plan) => ({ cardId: plan.id, plan, status: { name: 'waiting' } })),
  );
  const [phase, setPhase] = useState<'review' | 'sending' | 'done'>('review');
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, change: Partial<Item>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));

  async function approveAll() {
    setError(null);

    // A stale quote is re-quoted, never signed — before the fingerprint, so
    // the prompt approves the numbers that will actually go out.
    let fresh = items;
    try {
      fresh = await Promise.all(
        items.map(async (item) => (isPlanExpired(item.plan) ? { ...item, plan: await api.requotePlan(item.plan.id) } : item)),
      );
      setItems(fresh);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh those quotes.');
      return;
    }

    const approval = await confirmWithBiometrics(
      `Approve ${fresh.length}: ${fresh.map(({ plan }) => `${planVerb(plan)} ${planAmountLabel(plan)}`).join(', ')}`,
    );
    if (!approval.ok) {
      setError(approval.message);
      return;
    }

    setPhase('sending');

    for (const [index, item] of fresh.entries()) {
      update(index, { status: { name: 'sending' } });
      try {
        const result = await sendCalls(item.plan.calls, { optionalLast: Boolean(item.plan.route?.gasTopUp) });
        markPlanSent(item.cardId);
        const recorded = await reportWithRetry(item.plan.id, result.hashes);
        update(index, { status: { name: 'sent', recorded } });
      } catch (cause) {
        update(index, {
          status:
            cause instanceof SubmittedButUnconfirmedError
              ? { name: 'unconfirmed' }
              : { name: 'failed', message: cause instanceof Error ? cause.message : 'Not sent.' },
        });
      }
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setPhase('done');
  }

  const title = phase === 'done' ? 'Done' : phase === 'sending' ? 'Sending…' : `Approve ${items.length}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: insets.bottom + theme.space.xl }]}
    >
      <ScreenHeader title={title} onClose={phase === 'sending' ? undefined : () => router.back()} />

      <View style={{ gap: theme.space.md, marginTop: theme.space.lg }}>
        {items.map((item) => (
          <Tile key={item.cardId} style={{ padding: theme.space.lg, gap: 4 }}>
            <View style={styles.row}>
              <Text variant="label" tone="secondary">
                {planVerb(item.plan)}
              </Text>
              <StatusLabel status={item.status} />
            </View>
            <Text variant="bodyStrong">
              {planAmountLabel(item.plan)} {planDestinationLabel(item.plan)}
            </Text>
            {planArrivalLabel(item.plan) ? (
              <Text variant="caption" tone="tertiary">
                {planArrivalLabel(item.plan)}
              </Text>
            ) : null}
            {planGasTopUpLabel(item.plan) ? (
              <Text variant="caption" tone="tertiary">
                {planGasTopUpLabel(item.plan)}
              </Text>
            ) : null}
            <Text variant="caption" tone="tertiary">
              Fees {planFeeLabel(item.plan)}
            </Text>
            {item.status.name === 'failed' ? (
              <Text variant="caption" tone="warning">
                {item.status.message}
              </Text>
            ) : null}
            {item.status.name === 'unconfirmed' ? (
              <Text variant="caption" tone="warning">
                Submitted, still confirming. Check Activity before trying it again.
              </Text>
            ) : null}
          </Tile>
        ))}

        {items.length === 0 ? (
          <Text variant="body" tone="secondary" style={styles.center}>
            Those proposals are no longer here. Ask Blocky again.
          </Text>
        ) : null}

        {error ? (
          <Text variant="body" tone="warning" style={styles.center}>
            {error}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: theme.space.md, marginTop: theme.space.xxl }}>
        {phase === 'review' && items.length > 0 ? (
          <>
            <Button label={`Approve all ${items.length}`} haptic="heavy" disabled={!ready} onPress={() => void approveAll()} />
            <Button label="Cancel" variant="quiet" onPress={() => router.back()} />
          </>
        ) : null}
        {phase === 'done' ? <Button label="Done" onPress={() => router.back()} /> : null}
      </View>
    </ScrollView>
  );
}

function StatusLabel({ status }: { status: Status }) {
  switch (status.name) {
    case 'waiting':
      return null;
    case 'sending':
      return (
        <Text variant="caption" tone="tertiary">
          Sending…
        </Text>
      );
    case 'sent':
      return (
        <View style={styles.row}>
          <Icon name="checkmark" size={14} tone="positive" />
          <Text variant="caption" tone="positive">
            On its way
          </Text>
        </View>
      );
    case 'failed':
      return (
        <Text variant="caption" tone="warning">
          Not sent
        </Text>
      );
    case 'unconfirmed':
      return (
        <Text variant="caption" tone="warning">
          Confirming
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  center: {
    textAlign: 'center',
  },
});
