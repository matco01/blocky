import { displayUsd, formatUsd, parseUsd } from '@blocky/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlockPressable } from '../components/BlockPressable';
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
 * Where the money went, a month at a time, in the order people ask: how much
 * went out and how that compares with last month; what came in and what it
 * cost; where it went; who got most of it; and how that sits against the
 * budgets they set. Each part under its own heading, so the page can be
 * scanned rather than read.
 */
export default function InsightsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
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
  const atLatest = month >= thisMonth;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <ScreenHeader title="Insights" feature="sand" subtitle="Where every dollar went." onClose={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl, gap: theme.space.xxl }]}
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
        {/* Which month: the one control everything below answers to. */}
        <View style={styles.monthRow}>
          <MonthArrow icon="chevron-back" label="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} />
          <View style={styles.monthName}>
            <Text variant="heading">{monthName(month)}</Text>
            {atLatest ? (
              <Text variant="caption" tone="tertiary">
                So far this month
              </Text>
            ) : null}
          </View>
          <MonthArrow icon="chevron-forward" label="Next month" disabled={atLatest} onPress={() => setMonth(shiftMonth(month, 1))} />
        </View>

        {!data && !error ? <ActivityIndicator color={theme.colors.textTertiary} /> : null}
        {error ? (
          <Text variant="body" tone="warning" style={styles.center}>
            {error}
          </Text>
        ) : null}

        {insights ? (
          <>
            {/* Overview: out, then in and what it cost. */}
            <View style={{ gap: theme.space.lg }}>
              <View style={styles.hero}>
                <Text variant="label" tone="secondary">
                  Spent
                </Text>
                <Text variant="balance">{displayUsd(insights.spentUsd)}</Text>
                {change !== null ? (
                  <View
                    style={[
                      styles.pill,
                      { backgroundColor: change > 0 ? theme.colors.warningTint : theme.colors.accentTint, borderRadius: theme.radius.sm },
                    ]}
                  >
                    <Text variant="label" tone={change > 0 ? 'warning' : 'positive'}>
                      {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}% vs last month
                    </Text>
                  </View>
                ) : (
                  <Text variant="caption" tone="tertiary">
                    Sent to people and invested, fees apart
                  </Text>
                )}
              </View>

              <View style={[styles.stats, { gap: theme.space.sm }]}>
                <Stat label="Received" value={insights.receivedUsd} tone="positive" />
                {parseUsd(insights.soldUsd) > 0n ? <Stat label="Sold" value={insights.soldUsd} /> : null}
                <Stat label="Fees" value={insights.feesUsd} />
              </View>
            </View>

            {/* Where it went. */}
            <Section title="Where it went">
              {spent > 0n ? (
                <Tile style={{ padding: theme.space.lg, gap: theme.space.lg }}>
                  <SplitBar
                    parts={[
                      { value: insights.byCategory.people, color: theme.colors.brand },
                      { value: insights.byCategory.investing, color: theme.colors.accent },
                    ]}
                    total={insights.spentUsd}
                  />
                  <Legend color={theme.colors.brand} label="Sent to people" value={insights.byCategory.people} total={insights.spentUsd} />
                  <Legend color={theme.colors.accent} label="Invested" value={insights.byCategory.investing} total={insights.spentUsd} />
                </Tile>
              ) : (
                <Empty text={`Nothing spent in ${monthName(month).split(' ')[0]}${atLatest ? ' yet' : ''}.`} />
              )}
            </Section>

            {/* Who. */}
            {insights.topPeople.length > 0 ? (
              <Section title="Who you paid most">
                <Tile style={{ paddingHorizontal: theme.space.lg }}>
                  {insights.topPeople.map((person, index) => (
                    <View
                      key={person.name}
                      style={[
                        styles.row,
                        { paddingVertical: theme.space.md, gap: theme.space.md },
                        index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border } : null,
                      ]}
                    >
                      <Avatar name={person.name} index={index} />
                      <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <Text variant="bodyStrong" tabular>
                        {displayUsd(person.usd)}
                      </Text>
                    </View>
                  ))}
                </Tile>
              </Section>
            ) : null}

            {/* Budgets. */}
            <Section title="Budgets" subtitle="Set a monthly limit and Blocky warns you before you go over.">
              {(['people', 'investing', 'total'] as const).map((category) => {
                const budget = data.budgets.find((b) => b.category === category);
                const pct = budget ? Math.min(100, Number((parseUsd(budget.spentUsd) * 100n) / parseUsd(budget.monthlyUsd || '1'))) : 0;
                const left = budget ? parseUsd(budget.monthlyUsd) - parseUsd(budget.spentUsd) : 0n;
                const color = pct >= 100 ? theme.colors.danger : pct >= 80 ? theme.colors.warning : theme.colors.accent;
                return (
                  <Tile key={category} style={{ padding: theme.space.lg, gap: theme.space.sm }}>
                    <PressableScale
                      onPress={() => {
                        setEditing(editing === category ? null : category);
                        setDraft(budget?.monthlyUsd ?? '');
                      }}
                      accessibilityLabel={`${BUDGET_NAMES[category]} budget`}
                      haptic="none"
                      style={styles.row}
                    >
                      <Text variant="bodyStrong" style={{ flex: 1 }}>
                        {BUDGET_NAMES[category]}
                      </Text>
                      {budget ? (
                        <Text variant="body" tone="secondary" tabular>
                          {displayUsd(budget.spentUsd)} of {displayUsd(budget.monthlyUsd)}
                        </Text>
                      ) : (
                        <View style={[styles.row, { gap: 4 }]}>
                          <Icon name="add" size={18} tone="accent" />
                          <Text variant="bodyStrong" tone="accent">
                            Set a limit
                          </Text>
                        </View>
                      )}
                    </PressableScale>
                    {budget ? (
                      <>
                        <View style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}>
                          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
                        </View>
                        <Text variant="caption" tone={left < 0n ? 'danger' : 'tertiary'}>
                          {left < 0n ? `${displayUsd(formatUsd(-left))} over` : `${displayUsd(formatUsd(left))} left`}
                        </Text>
                      </>
                    ) : null}
                    {editing === category ? (
                      <View style={[styles.row, { gap: theme.space.sm, alignItems: 'flex-end' }]}>
                        <View style={{ flex: 1 }}>
                          <TextField label="A month, in dollars" value={draft} onChangeText={setDraft} keyboardType="decimal-pad" placeholder="0 to remove" />
                        </View>
                        <Button label="Save" size="compact" onPress={() => void saveBudget(category)} />
                      </View>
                    ) : null}
                  </Tile>
                );
              })}
            </Section>

            <View style={[styles.row, { gap: theme.space.sm }]}>
              <View style={{ flex: 1 }}>
                <Button label="Savings pots" variant="secondary" size="compact" onPress={() => router.push('/pots')} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Export CSV" variant="secondary" size="compact" onPress={() => void exportMonth()} />
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="tertiary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function MonthArrow({ icon, label, onPress, disabled }: { icon: 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <BlockPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      haptic="light"
      height={44}
      radius={theme.radius.md}
      fill={theme.colors.surface}
      edge={theme.colors.borderStrong}
      stroke={theme.colors.border}
      style={{ width: 44 }}
    >
      <Icon name={icon} size={20} tone={disabled ? 'tertiary' : 'primary'} />
    </BlockPressable>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  const theme = useTheme();
  return (
    <Tile muted style={{ flex: 1, padding: theme.space.md, gap: 2 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="heading" tone={tone ?? 'primary'} tabular numberOfLines={1} adjustsFontSizeToFit>
        {displayUsd(value)}
      </Text>
    </Tile>
  );
}

/** One bar, split by share: the shape of the month at a glance. */
function SplitBar({ parts, total }: { parts: { value: string; color: string }[]; total: string }) {
  const theme = useTheme();
  const whole = parseUsd(total);
  return (
    <View style={[styles.split, { backgroundColor: theme.colors.surfaceMuted }]}>
      {parts.map((part, index) => {
        const pct = whole > 0n ? Number((parseUsd(part.value) * 1000n) / whole) / 10 : 0;
        return pct > 0 ? <View key={index} style={{ width: `${pct}%`, backgroundColor: part.color }} /> : null;
      })}
    </View>
  );
}

function Legend({ color, label, value, total }: { color: string; label: string; value: string; total: string }) {
  const whole = parseUsd(total);
  const pct = whole > 0n ? Math.round(Number((parseUsd(value) * 100n) / whole)) : 0;
  return (
    <View style={[styles.row, { gap: 10 }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="caption" tone="tertiary" tabular>
        {pct}%
      </Text>
      <Text variant="bodyStrong" tabular style={styles.amount}>
        {displayUsd(value)}
      </Text>
    </View>
  );
}

/** A rounded square with the first letter, in the website's avatar colours. */
function Avatar({ name, index }: { name: string; index: number }) {
  const theme = useTheme();
  const fills = [theme.colors.brand, theme.colors.accent, theme.colors.warning, theme.colors.ink];
  const letter = (name.replace(/^@/, '').match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
  return (
    <View style={[styles.avatar, { backgroundColor: fills[index % fills.length], borderRadius: theme.radius.md }]}>
      <Text variant="bodyStrong" style={{ color: index % fills.length === 3 ? theme.colors.inkText : theme.colors.textInverted }}>
        {letter}
      </Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Tile muted style={{ padding: theme.space.xl }}>
      <Text variant="body" tone="secondary" style={styles.center}>
        {text}
      </Text>
    </Tile>
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
  content: { paddingHorizontal: 24, paddingTop: 16 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthName: { alignItems: 'center' },
  hero: { alignItems: 'center', gap: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 4 },
  stats: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  split: { height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  amount: { minWidth: 72, textAlign: 'right' },
  avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  center: { textAlign: 'center' },
});
