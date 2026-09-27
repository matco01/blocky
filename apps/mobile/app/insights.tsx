import { displayUsd, parseUsd } from '@blocky/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { Tile } from '../components/Tile';
import { api, type Insights } from '../lib/api';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

type BudgetCategory = 'people' | 'investing' | 'total';

const BUDGET_NAMES: Record<BudgetCategory, string> = {
  people: 'Sending to people',
  investing: 'Investing',
  total: 'Everything',
};

/**
 * Where the money went, a month at a time: what was spent and how that
 * compares with last month, split by what it went on, fees, money in, the
 * people paid most — and budgets beside what they've spent. Card spending
 * lands here as another category when the card does.
 */
export default function InsightsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<BudgetCategory | null>(null);
  const [draft, setDraft] = useState('');

  const fetchInsights = useCallback(async () => {
    try {
      setData(await api.insights(month));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    }
  }, [month]);

  useFocusEffect(
    useCallback(() => {
      void fetchInsights();
    }, [fetchInsights]),
  );

  async function saveBudget(category: BudgetCategory) {
    const value = draft.trim().replace('$', '');
    await api.setBudget(category, value === '' || value === '0' ? null : value).catch(() => {});
    setEditing(null);
    setDraft('');
    await fetchInsights();
  }

  async function exportMonth() {
    const csv = await api.statement(month).catch(() => null);
    if (csv) await Share.share({ title: `Blocky statement ${month}`, message: csv });
  }

  const insights = data?.insights;
  const spent = insights ? parseUsd(insights.spentUsd) : 0n;
  const last = insights?.lastMonthSpentUsd ? parseUsd(insights.lastMonthSpentUsd) : null;
  const change = last && last > 0n ? Number(((spent - last) * 1000n) / last) / 10 : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <ScreenHeader title="Insights" onClose={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl, gap: theme.space.lg }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await fetchInsights();
              setRefreshing(false);
            }}
            tintColor={theme.colors.textTertiary}
          />
        }
      >
        <View style={styles.monthRow}>
          <PressableScale onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel="Previous month">
            <Icon name="chevron-back" size={22} tone="secondary" />
          </PressableScale>
          <Text variant="bodyStrong">{monthName(month)}</Text>
          <PressableScale
            onPress={() => setMonth(shiftMonth(month, 1))}
            accessibilityLabel="Next month"
            disabled={month >= new Date().toISOString().slice(0, 7)}
          >
            <Icon name="chevron-forward" size={22} tone={month >= new Date().toISOString().slice(0, 7) ? 'tertiary' : 'secondary'} />
          </PressableScale>
        </View>

        {!data && !error ? <ActivityIndicator color={theme.colors.textTertiary} /> : null}
        {error ? (
          <Text variant="body" tone="warning" style={styles.center}>
            {error}
          </Text>
        ) : null}

        {insights ? (
          <>
            <View style={styles.hero}>
              <Text variant="caption" tone="secondary">
                Spent
              </Text>
              <Text variant="balance">{displayUsd(insights.spentUsd)}</Text>
              {change !== null ? (
                <Text variant="caption" tone={change > 0 ? 'warning' : 'positive'}>
                  {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}% vs last month
                </Text>
              ) : null}
            </View>

            <Tile style={{ padding: theme.space.lg, gap: theme.space.md }}>
              <Bar label="Sent to people" value={insights.byCategory.people} total={insights.spentUsd} />
              <Bar label="Invested" value={insights.byCategory.investing} total={insights.spentUsd} />
              <Line label="Fees" value={insights.feesUsd} />
              <Line label="Received from people" value={insights.receivedUsd} />
              {parseUsd(insights.soldUsd) > 0n ? <Line label="Sold back to dollars" value={insights.soldUsd} /> : null}
            </Tile>

            {insights.topPeople.length > 0 ? (
              <View style={{ gap: theme.space.sm }}>
                <Text variant="label" tone="secondary">
                  Who you paid most
                </Text>
                {insights.topPeople.map((person) => (
                  <Line key={person.name} label={person.name} value={person.usd} />
                ))}
              </View>
            ) : null}

            <View style={{ gap: theme.space.sm }}>
              <Text variant="label" tone="secondary">
                Budgets
              </Text>
              {(['people', 'investing', 'total'] as const).map((category) => {
                const budget = data.budgets.find((b) => b.category === category);
                const pct = budget ? Math.min(100, Number((parseUsd(budget.spentUsd) * 100n) / parseUsd(budget.monthlyUsd || '1'))) : 0;
                return (
                  <Tile key={category} style={{ padding: theme.space.md, gap: theme.space.xs }}>
                    <PressableScale
                      onPress={() => {
                        setEditing(editing === category ? null : category);
                        setDraft(budget?.monthlyUsd ?? '');
                      }}
                      accessibilityLabel={`${BUDGET_NAMES[category]} budget`}
                      style={styles.row}
                    >
                      <Text variant="bodyStrong" style={{ flex: 1 }}>
                        {BUDGET_NAMES[category]}
                      </Text>
                      <Text variant="body" tone="secondary">
                        {budget ? `${displayUsd(budget.spentUsd)} of ${displayUsd(budget.monthlyUsd)}` : 'Set a budget'}
                      </Text>
                    </PressableScale>
                    {budget ? (
                      <View style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}>
                        <View
                          style={[
                            styles.fill,
                            { width: `${pct}%`, backgroundColor: pct >= 100 ? theme.colors.danger : pct >= 80 ? theme.colors.warning : theme.colors.accent },
                          ]}
                        />
                      </View>
                    ) : null}
                    {editing === category ? (
                      <View style={[styles.row, { gap: theme.space.sm }]}>
                        <View style={{ flex: 1 }}>
                          <TextField label="A month, in dollars" value={draft} onChangeText={setDraft} keyboardType="decimal-pad" placeholder="0 to remove" />
                        </View>
                        <Button label="Save" size="compact" onPress={() => void saveBudget(category)} />
                      </View>
                    ) : null}
                  </Tile>
                );
              })}
            </View>

            <View style={{ gap: theme.space.sm }}>
              <Button label="Savings pots" variant="quiet" onPress={() => router.push('/pots')} />
              <Button label="Export this month (CSV)" variant="quiet" onPress={() => void exportMonth()} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Bar({ label, value, total }: { label: string; value: string; total: string }) {
  const theme = useTheme();
  const whole = parseUsd(total);
  const pct = whole > 0n ? Number((parseUsd(value) * 100n) / whole) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.row}>
        <Text variant="body" style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="bodyStrong">{displayUsd(value)}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: theme.colors.accent }]} />
      </View>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="body">{displayUsd(value)}</Text>
    </View>
  );
}

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(year, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthName(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 24 },
  content: { paddingHorizontal: 24, paddingTop: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  center: { textAlign: 'center' },
});
