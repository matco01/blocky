import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton } from '../components/ActionButton';
import { BalanceDisplay } from '../components/BalanceDisplay';
import { Text } from '../components/Text';
import { api } from '../lib/api';
import { useTheme } from '../theme';

/**
 * Home.
 *
 * One balance, Receive, Send, recent activity. Nothing else — no chain
 * selector, no token list, no gas indicator. Everything more complicated than
 * this is the agent's job, and it lives one tab away.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.balance();
      setBalance(result.totalUsd);
      setOffline(false);
    } catch {
      // A stale balance beats a spinner that never resolves. Keep the last
      // known number on screen and say quietly that it may be out of date.
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.space.xxxl, paddingBottom: insets.bottom + theme.space.xl },
      ]}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.textTertiary} />
      }
    >
      <BalanceDisplay totalUsd={balance} loading={loading} />

      {offline ? (
        <Text variant="caption" tone="warning" style={styles.offline}>
          Can't reach the network — showing your last known balance.
        </Text>
      ) : null}

      <View style={[styles.actions, { gap: theme.space.md, marginTop: theme.space.xxl }]}>
        <ActionButton label="Receive" glyph="↓" />
        <ActionButton label="Send" glyph="↑" variant="primary" />
      </View>

      <View style={[styles.section, { marginTop: theme.space.xxxl }]}>
        <Text variant="label" tone="tertiary" style={styles.sectionTitle}>
          Activity
        </Text>

        <View
          style={[
            styles.empty,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space.xl,
            },
          ]}
        >
          <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
            Nothing yet.
          </Text>
          <Text variant="caption" tone="tertiary" style={{ textAlign: 'center', marginTop: 4 }}>
            Add some USDC to get started.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  offline: {
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
    marginBottom: 12,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
