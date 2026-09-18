import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityRow } from '../components/ActivityRow';
import { PressableScale } from '../components/PressableScale';
import { Text } from '../components/Text';
import { api, type ActivityItem } from '../lib/api';
import { useTheme } from '../theme';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; items: ActivityItem[]; complete: boolean }
  | { state: 'error'; message: string };

/** Everything that moved in and out of the wallet, newest first. */
export default function ActivityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

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
      <View style={[styles.header, { paddingTop: theme.space.xl }]}>
        <Text variant="title">Activity</Text>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Done" haptic="none">
          <Text variant="bodyStrong" tone="accent">
            Done
          </Text>
        </PressableScale>
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

        {load.state === 'ready' ? load.items.map((item) => <ActivityRow key={item.id} item={item} />) : null}

        {load.state === 'ready' && !load.complete ? (
          <Text variant="caption" tone="tertiary" style={[styles.center, { marginTop: theme.space.lg }]}>
            Some incoming activity may be missing right now.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
