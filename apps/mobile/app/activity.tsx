import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityDetailSheet } from '../components/ActivityDetailSheet';
import { ActivityRow } from '../components/ActivityRow';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { api, type ActivityItem } from '../lib/api';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; items: ActivityItem[]; complete: boolean }
  | { state: 'error'; message: string };

/**
 * Everything that moved in and out of the wallet, newest first. Opened from a
 * "you got paid" notification (`?tx=`), it opens on that payment.
 */
export default function ActivityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { tx } = useLocalSearchParams<{ tx?: string }>();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ActivityItem | null>(null);

  // Once: closing the sheet and refreshing mustn't open it again.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (load.state !== 'ready' || !tx || openedFor.current === tx) return;
    const wanted = tx.toLowerCase();
    const item =
      load.items.find((entry) => entry.txHash.toLowerCase() === wanted && entry.direction === 'received') ??
      load.items.find((entry) => entry.txHash.toLowerCase() === wanted);
    if (!item) return;
    openedFor.current = tx;
    setOpen(item);
  }, [load, tx]);

  const fetchActivity = useCallback(async () => {
    try {
      const result = await api.activity();
      setLoad({ state: 'ready', items: result.items, complete: result.complete });
    } catch (error) {
      setLoad({ state: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchActivity();
    }, [fetchActivity]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivity();
    setRefreshing(false);
  }, [fetchActivity]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <ScreenHeader title="Activity" feature="sand" subtitle="Everything in and out." onClose={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.textTertiary} />}
      >
        {load.state === 'loading' ? (
          <ActivityIndicator style={{ marginTop: theme.space.xxl }} color={theme.colors.textTertiary} />
        ) : null}

        {load.state === 'error' ? (
          <Text variant="body" tone="warning" style={[styles.center, { marginTop: theme.space.xxl }]}>
            {load.message}
          </Text>
        ) : null}

        {load.state === 'ready' && load.items.length === 0 ? (
          <View style={[styles.empty, { marginTop: theme.space.xxl }]}>
            <Text variant="body" tone="secondary" style={styles.center}>
              Nothing yet.
            </Text>
            <Text variant="caption" tone="tertiary" style={styles.center}>
              Money you send and receive will show up here.
            </Text>
          </View>
        ) : null}

        {load.state === 'ready'
          ? byDay(load.items).map(([day, items]) => (
              <View key={day}>
                <Text variant="label" tone="secondary" style={{ marginTop: theme.space.lg, marginBottom: theme.space.xs }}>
                  {day}
                </Text>
                {items.map((item) => (
                  <ActivityRow key={item.id} item={item} onPress={() => setOpen(item)} />
                ))}
              </View>
            ))
          : null}

        {load.state === 'ready' && !load.complete ? (
          <Text variant="caption" tone="tertiary" style={[styles.center, { marginTop: theme.space.lg }]}>
            Some incoming activity may be missing right now.
          </Text>
        ) : null}
      </ScrollView>

      <ActivityDetailSheet item={open} onClose={() => setOpen(null)} />
    </View>
  );
}

/** Newest first, grouped under "Today", "Yesterday", then the date. */
function byDay(items: readonly ActivityItem[]): [string, ActivityItem[]][] {
  const groups = new Map<string, ActivityItem[]>();
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  for (const item of items) {
    const date = new Date(item.timestamp);
    const label = sameDay(date, today)
      ? 'Today'
      : sameDay(date, yesterday)
        ? 'Yesterday'
        : date.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'long',
            ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
          });
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }

  return [...groups];
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  content: {
    paddingHorizontal: 24,
  },
  center: {
    textAlign: 'center',
  },
  empty: {
    gap: 4,
  },
});
