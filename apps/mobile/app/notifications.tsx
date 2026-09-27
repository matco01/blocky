import { displayUsd } from '@blocky/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { Tile } from '../components/Tile';
import { api, type AppNotification, type PaymentRequest } from '../lib/api';
import { payRequest } from '../lib/requests';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; items: AppNotification[]; waiting: PaymentRequest[] }
  | { state: 'error'; message: string };

/**
 * What the user should know about: requests waiting on them first — each
 * payable or declinable right here — then everything else, newest first.
 * Opening it marks it all read.
 */
export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Requests from people they've never dealt with: kept folded until asked for.
  const [showStrangers, setShowStrangers] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [notifications, requests] = await Promise.all([api.notifications(), api.requests()]);
      setLoad({ state: 'ready', items: notifications.items, waiting: requests.incoming.filter((r) => r.status === 'open') });
      if (notifications.unread > 0) void api.markNotificationsRead().catch(() => {});
    } catch (cause) {
      setLoad({ state: 'error', message: cause instanceof Error ? cause.message : 'Something went wrong.' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  async function pay(request: PaymentRequest) {
    setBusy(request.id);
    setError(null);
    try {
      await payRequest(request.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare that payment.');
    } finally {
      setBusy(null);
    }
  }

  async function block(request: PaymentRequest) {
    setBusy(request.id);
    try {
      await api.blockRequester(request.id);
      await fetchAll();
    } finally {
      setBusy(null);
    }
  }

  async function decline(request: PaymentRequest) {
    setBusy(request.id);
    try {
      await api.declineRequest(request.id);
      await fetchAll();
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <ScreenHeader title="Notifications" onClose={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl, gap: theme.space.md }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await fetchAll();
              setRefreshing(false);
            }}
            tintColor={theme.colors.textTertiary}
          />
        }
      >
        {load.state === 'loading' ? <ActivityIndicator style={{ marginTop: theme.space.xxl }} color={theme.colors.textTertiary} /> : null}
        {load.state === 'error' ? (
          <Text variant="body" tone="warning" style={styles.center}>
            {load.message}
          </Text>
        ) : null}
        {error ? (
          <Text variant="body" tone="warning" style={styles.center}>
            {error}
          </Text>
        ) : null}

        {load.state === 'ready' ? (
          <>
            {load.waiting
              .filter((request) => !request.fromStranger)
              .map((request) => (
                <RequestCard key={request.id} request={request} busy={busy === request.id} onPay={pay} onDecline={decline} />
              ))}

            {load.waiting.some((request) => request.fromStranger) ? (
              <View style={{ gap: theme.space.sm }}>
                <PressableScale onPress={() => setShowStrangers((open) => !open)} accessibilityLabel="Requests from people you don't know" style={styles.row}>
                  <Text variant="label" tone="secondary" style={{ flex: 1 }}>
                    From people you don't know ({load.waiting.filter((request) => request.fromStranger).length})
                  </Text>
                  <Icon name={showStrangers ? 'chevron-up' : 'chevron-down'} size={18} tone="tertiary" />
                </PressableScale>
                {showStrangers ? (
                  <>
                    <Text variant="caption" tone="tertiary">
                      You haven't sent money to or received money from these people. Only pay if you know what it's for.
                    </Text>
                    {load.waiting
                      .filter((request) => request.fromStranger)
                      .map((request) => (
                        <RequestCard
                          key={request.id}
                          request={request}
                          busy={busy === request.id}
                          onPay={pay}
                          onDecline={decline}
                          onBlock={block}
                        />
                      ))}
                  </>
                ) : null}
              </View>
            ) : null}

            {load.items.map((item) => (
              <View key={item.id} style={[styles.item, { borderBottomColor: theme.colors.border }]}>
                <View style={styles.row}>
                  {!item.read ? <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} /> : null}
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {item.title}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>
                <Text variant="body" tone="secondary">
                  {item.body}
                </Text>
              </View>
            ))}

            {load.items.length === 0 && load.waiting.length === 0 ? (
              <Text variant="body" tone="secondary" style={[styles.center, { marginTop: theme.space.xxl }]}>
                Nothing yet. Payments, requests and alerts show up here.
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** A request to pay: how much, who from, what for — and what to do about it. */
function RequestCard(props: {
  request: PaymentRequest;
  busy: boolean;
  onPay: (request: PaymentRequest) => void;
  onDecline: (request: PaymentRequest) => void;
  onBlock?: (request: PaymentRequest) => void;
}) {
  const theme = useTheme();
  const { request } = props;
  return (
    <Tile style={{ padding: theme.space.lg, gap: theme.space.sm }}>
      <Text variant="label" tone="secondary">
        Request
      </Text>
      <Text variant="heading">{displayUsd(request.amountUsd)}</Text>
      <Text variant="body" tone="secondary">
        from {request.requesterUsername ? `@${request.requesterUsername}` : 'someone'}
        {request.note ? ` · ${request.note}` : ''}
      </Text>
      <View style={[styles.row, { gap: theme.space.sm, marginTop: theme.space.xs }]}>
        <View style={{ flex: 1 }}>
          <Button label="Pay" loading={props.busy} onPress={() => props.onPay(request)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Decline" variant="quiet" onPress={() => props.onDecline(request)} />
        </View>
      </View>
      {props.onBlock ? <Button label="Block this person" size="compact" variant="quiet" onPress={() => props.onBlock!(request)} /> : null}
    </Tile>
  );
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 24 },
  content: { paddingHorizontal: 24, paddingTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  item: { paddingVertical: 12, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  center: { textAlign: 'center' },
});
