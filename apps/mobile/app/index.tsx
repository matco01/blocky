import { usePrivy } from '@privy-io/expo';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton } from '../components/ActionButton';
import { ActivityRow } from '../components/ActivityRow';
import { BalanceDisplay } from '../components/BalanceDisplay';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { ApiError, api, type ActivityItem } from '../lib/api';
import { useTheme } from '../theme';

type Load =
  | { state: 'loading' }
  | { state: 'setting-up' }
  | { state: 'ready'; balance: string; activity: ActivityItem[]; activityComplete: boolean }
  | { state: 'error'; message: string; lastBalance: string | null };

/**
 * Home.
 *
 * One balance, Receive, Send, recent activity. Nothing else — no chain
 * selector, no token list, no gas indicator. Everything more complicated than
 * this is the agent's job.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { logout } = usePrivy();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const lastBalance = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [balance, activity] = await Promise.all([api.balance(), api.activity()]);
      lastBalance.current = balance.totalUsd;
      setLoad({
        state: 'ready',
        balance: balance.totalUsd,
        activity: activity.items,
        activityComplete: activity.complete,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wallet_not_ready') {
        setLoad({ state: 'setting-up' });
        return;
      }
      // Keep the last known number on screen. A spinner that never resolves, or
      // a zero, both say something false about the user's money.
      setLoad({
        state: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
        lastBalance: lastBalance.current,
      });
    }
  }, []);

  // Refetch whenever Home comes back into view — most importantly, after Send.
  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  // The wallet is created at first login and can take a moment to appear on
  // the server. Poll gently until it does.
  useEffect(() => {
    if (load.state !== 'setting-up') return;
    const timer = setTimeout(() => void fetchAll(), 2000);
    return () => clearTimeout(timer);
  }, [load, fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const balance =
    load.state === 'ready' ? load.balance : load.state === 'error' ? (load.lastBalance ?? '0') : '0';

  const canTransact = load.state === 'ready' || (load.state === 'error' && load.lastBalance !== null);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.space.xxxl, paddingBottom: insets.bottom + theme.space.xl },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.textTertiary} />
      }
    >
      <BalanceDisplay totalUsd={balance} loading={load.state === 'loading' || load.state === 'setting-up'} />

      {load.state === 'setting-up' ? (
        <Text variant="caption" tone="tertiary" style={styles.notice}>
          Setting up your wallet…
        </Text>
      ) : null}

      {load.state === 'error' ? (
        <Text variant="caption" tone="warning" style={styles.notice}>
          {load.lastBalance === null ? load.message : `${load.message} Showing your last known balance.`}
        </Text>
      ) : null}

      <View style={[styles.actions, { gap: theme.space.md, marginTop: theme.space.xxl }]}>
        <ActionButton label="Receive" glyph="↓" disabled={!canTransact} onPress={() => router.push('/receive')} />
        <ActionButton
          label="Send"
          glyph="↑"
          variant="primary"
          disabled={!canTransact}
          onPress={() => router.push('/send')}
        />
      </View>

      <View style={[styles.section, { marginTop: theme.space.xxxl }]}>
        <Text variant="label" tone="tertiary" style={styles.sectionTitle}>
          Activity
        </Text>

        {load.state === 'ready' && load.activity.length > 0 ? (
          <View>
            {load.activity.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </View>
        ) : (
          <View
            style={[
              styles.empty,
              { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.space.xl },
            ]}
          >
            <Text variant="body" tone="secondary" style={styles.center}>
              {load.state === 'ready' ? 'Nothing yet.' : ' '}
            </Text>
            {load.state === 'ready' ? (
              <Text variant="caption" tone="tertiary" style={[styles.center, { marginTop: 4 }]}>
                Tap Receive to add USDC.
              </Text>
            ) : null}
          </View>
        )}

        {load.state === 'ready' && !load.activityComplete ? (
          <Text variant="caption" tone="tertiary" style={[styles.notice, { marginTop: theme.space.md }]}>
            Some incoming activity may be missing right now.
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: theme.space.xxl }}>
        <Button label="Sign out" variant="quiet" onPress={() => void logout()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  notice: {
    textAlign: 'center',
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
  },
  section: {
    flex: 1,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  center: {
    textAlign: 'center',
  },
});
