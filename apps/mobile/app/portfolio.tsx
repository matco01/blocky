import { displayUsd, formatUnits, parseUsd } from '@blocky/shared';
import { CHAINS, STOCK_CHAIN, stockBySymbol } from '@blocky/wallet-core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PortfolioDonut } from '../components/PortfolioDonut';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScrubChart, type ChartPoint } from '../components/ScrubChart';
import { Text } from '../components/Text';
import { Tile } from '../components/Tile';
import { api, type BalanceHistory } from '../lib/api';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

/**
 * Four fixed slots plus "Other" — validated (CVD-safe, contrast-safe) against
 * both chart surfaces. Slot assignment is by chain identity, never by rank, so
 * a chain keeps its colour as balances shift.
 */
const SLOT_COLORS = {
  light: ['#B87A0F', '#0E8A78', '#3A6FC4', '#B23E6B'],
  dark: ['#BD8020', '#25A08D', '#5E86D6', '#C15E88'],
} as const;

const MAX_SLICES = 4;
/** Matches `styles.tabs.padding` — the inset the sliding pill sits inside. */
const TAB_PAD = 3;

/** Matches the server's price snapshot TTL — polling faster would only re-read the same prices. */
const PRICE_REFRESH_MS = 30_000;

type Tab = 'spendable' | 'investments';

function chainName(id: number): string {
  return (CHAINS as Record<number, { name: string }>)[id]?.name ?? `Chain ${id}`;
}

function slotColor(index: number, colors: readonly string[]): string {
  return colors[index % colors.length] ?? colors[0] ?? '#888888';
}

/** Trimmed to a readable length — this is a fallback display for an unpriced asset, not a monetary value. */
function formatTokenAmount(amountBase: string, decimals: number): string {
  const [whole = '0', frac = ''] = formatUnits(BigInt(amountBase), decimals).split('.');
  return frac ? `${whole}.${frac.slice(0, 6)}` : whole;
}

interface Holding {
  key: string;
  /** What it is — "USDC", "ETH", "Apple". */
  label: string;
  /** Where it is — "on Ethereum" — on the line beneath. Absent for "Other". */
  where?: string;
  /** null when we have no price for this asset — real money, just not priceable right now. */
  usdCents: bigint | null;
  /** Shown instead of a dollar amount when `usdCents` is null. */
  amountText?: string;
}

interface TabData {
  holdings: Holding[];
  totalCents: bigint;
  /** Recorded snapshots, oldest first. Only real readings — never interpolated. */
  history: ChartPoint[];
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; spendable: TabData; investments: TabData }
  | { state: 'error'; message: string };

/** Everything the wallet holds, split the way the money actually behaves: spendable stablecoins versus everything else. */
export default function PortfolioScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { width: windowWidth } = useWindowDimensions();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('spendable');
  // A finger dragging along the chart must not also swipe the pager.
  const [scrubbing, setScrubbing] = useState(false);

  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);

  const onPagerScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const fetchPortfolio = useCallback(async () => {
    try {
      const [balance, historyResult] = await Promise.all([
        api.balance(),
        api.balanceHistory().catch((): BalanceHistory => ({ snapshots: [] })),
      ]);

      const spendableHoldings: Holding[] = [];
      const arcCents = parseUsd(balance.usdc.displayAmount);
      if (arcCents > 0n) {
        spendableHoldings.push({ key: `chain-${balance.chainId}`, label: 'USDC', where: `on ${chainName(balance.chainId)}`, usdCents: arcCents });
      }

      const gatewayChains = [...(balance.gateway?.perChain ?? [])].sort((a, b) => a.chainId - b.chainId);
      for (const entry of gatewayChains) {
        const cents = parseUsd(entry.balanceUsd);
        if (cents > 0n) {
          spendableHoldings.push({ key: `chain-${entry.chainId}`, label: 'USDC', where: `on ${chainName(entry.chainId)}`, usdCents: cents });
        }
      }

      // USDC moved to another chain is still cash; it sits with the rest of
      // the dollars, labelled by where it is.
      for (const holding of balance.otherHoldings.filter((h) => h.stable && h.usd)) {
        spendableHoldings.push({
          key: `token-${holding.chainId}-${holding.symbol}`,
          label: holding.symbol,
          where: `on ${chainName(holding.chainId)}`,
          usdCents: parseUsd(holding.usd!),
        });
      }

      const investmentHoldings: Holding[] = balance.otherHoldings
        .filter((holding) => !(holding.stable && holding.usd))
        .map((holding) => {
          const key = `token-${holding.chainId}-${holding.symbol}`;
          // A stock reads as the company — "Apple" — with its ticker beneath.
          const stock = holding.chainId === STOCK_CHAIN ? stockBySymbol(holding.symbol) : null;
          const label = stock ? stock.name : holding.symbol;
          const where = stock ? `${stock.symbol} ${stock.fund ? 'fund' : 'stock'} · on ${chainName(holding.chainId)}` : `on ${chainName(holding.chainId)}`;
          return holding.usd
            ? { key, label, where, usdCents: parseUsd(holding.usd) }
            : { key, label, where, usdCents: null, amountText: formatTokenAmount(holding.amount, holding.decimals) };
        });

      const spendableTotal = spendableHoldings.reduce((sum, h) => sum + (h.usdCents ?? 0n), 0n);
      const investmentsTotal = investmentHoldings.reduce((sum, h) => sum + (h.usdCents ?? 0n), 0n);

      setLoad({
        state: 'ready',
        spendable: {
          holdings: spendableHoldings,
          totalCents: spendableTotal,
          history: historyResult.snapshots.map((s) => ({ t: Date.parse(s.takenAt), v: Number(s.spendableUsd) })),
        },
        investments: {
          holdings: investmentHoldings,
          totalCents: investmentsTotal,
          history: historyResult.snapshots.map((s) => ({ t: Date.parse(s.takenAt), v: Number(s.investmentsUsd) })),
        },
      });
    } catch (error) {
      setLoad({ state: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
  }, []);

  // Live while on screen: prices move, so re-read on the same beat the
  // server refreshes its shared price snapshot. Nothing polls once it closes.
  useFocusEffect(
    useCallback(() => {
      void fetchPortfolio();
      const timer = setInterval(() => void fetchPortfolio(), PRICE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [fetchPortfolio]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPortfolio();
    setRefreshing(false);
  }, [fetchPortfolio]);

  const onPagerMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
      setTab(page === 0 ? 'spendable' : 'investments');
    },
    [windowWidth],
  );

  const goToTab = useCallback(
    (next: Tab) => {
      scrollRef.current?.scrollTo({ x: next === 'spendable' ? 0 : windowWidth, animated: true });
      setTab(next);
    },
    [windowWidth],
  );

  const colors = SLOT_COLORS[theme.scheme];
  const chartWidth = windowWidth - 48;

  // The pill slides exactly as far as a finger has dragged the pager, rather
  // than snapping once a swipe completes — the same trick the page dots use.
  const tabsContainerWidth = windowWidth - 48;
  const tabWidth = (tabsContainerWidth - TAB_PAD * 2) / 2;
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(scrollX.value, [0, windowWidth], [0, tabWidth], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <ScreenHeader title="Portfolio" onClose={() => router.back()} />
      </View>

      {load.state === 'ready' ? (
        <View style={styles.tabsWrap}>
          <Tile muted radius={theme.radius.md} style={styles.tabs}>
            <Animated.View
              style={[
                styles.indicator,
                indicatorStyle,
                { width: tabWidth, backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm },
              ]}
            />
            <TabButton label="Spendable" selected={tab === 'spendable'} onPress={() => goToTab('spendable')} />
            <TabButton label="Investments" selected={tab === 'investments'} onPress={() => goToTab('investments')} />
          </Tile>
        </View>
      ) : null}

      {load.state === 'loading' ? <ActivityIndicator style={{ marginTop: theme.space.xxl }} color={theme.colors.textTertiary} /> : null}

      {load.state === 'error' ? (
        <Text variant="body" tone="warning" style={[styles.center, { marginTop: theme.space.xxl }]}>
          {load.message}
        </Text>
      ) : null}

      {load.state === 'ready' ? (
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={!scrubbing}
          showsHorizontalScrollIndicator={false}
          onScroll={onPagerScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={onPagerMomentumEnd}
        >
          <ScrollView
            style={{ width: windowWidth }}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.textTertiary} />}
          >
            <HoldingsSection
              data={load.spendable}
              colors={colors}
              chartWidth={chartWidth}
              emptyTitle="Nothing here yet."
              emptySubtitle="Money you hold will show up here."
            />
          </ScrollView>

          <ScrollView
            style={{ width: windowWidth }}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.textTertiary} />}
          >
            <HoldingsSection
              data={load.investments}
              colors={colors}
              chartWidth={chartWidth}
              chart
              onScrubbingChange={setScrubbing}
              emptyTitle="No investments yet."
              emptySubtitle="ETH and other assets you hold will show up here."
            />
          </ScrollView>
        </Animated.ScrollView>
      ) : null}
    </View>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} haptic="light" style={styles.tabButtonWrap}>
      <View style={styles.tabButton}>
        <Text variant="label" tone={selected ? 'primary' : 'secondary'}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

function HoldingsSection({
  data,
  colors,
  chartWidth,
  chart = false,
  onScrubbingChange,
  emptyTitle,
  emptySubtitle,
}: {
  data: TabData;
  colors: readonly string[];
  chartWidth: number;
  /**
   * Investments only. Spendable money is dollars: its line is flat except
   * when money comes in or goes out, which the activity feed already tells
   * better. Prices move investments, and that is what a chart is for.
   */
  chart?: boolean;
  onScrubbingChange?: (scrubbing: boolean) => void;
  emptyTitle: string;
  emptySubtitle: string;
}) {
  const theme = useTheme();
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  // The chart can only place a value it can price. Priced holdings past the
  // four named slots fold into one "Other" wedge; an unpriced holding is real
  // money too, so it's never folded — just listed below with its raw amount
  // instead of a dollar figure.
  const priced = data.holdings.filter((h): h is Holding & { usdCents: bigint } => h.usdCents !== null);
  const unpriced = data.holdings.filter((h) => h.usdCents === null);

  const shaped = (() => {
    const named = priced.slice(0, MAX_SLICES);
    const rest = priced.slice(MAX_SLICES);
    const otherCents = rest.reduce((sum, h) => sum + h.usdCents, 0n);
    return otherCents > 0n ? [...named, { key: 'other', label: 'Other', usdCents: otherCents }] : named;
  })();

  const totalShown = shaped.length + unpriced.length;

  if (totalShown === 0) {
    return (
      <View style={[styles.empty, { marginTop: theme.space.xxl }]}>
        <Text variant="body" tone="secondary" style={styles.center}>
          {emptyTitle}
        </Text>
        <Text variant="caption" tone="tertiary" style={styles.center}>
          {emptySubtitle}
        </Text>
      </View>
    );
  }

  const showChart = chart && data.history.length >= 2;
  const scrubbed = scrubIndex === null ? null : (data.history[scrubIndex] ?? null);

  // While scrubbing, the headline is that moment's recorded value; otherwise
  // it is the live total. Either way the change is measured from the start of
  // the period on screen.
  const shownValue = scrubbed ? usdFromNumber(scrubbed.v) : data.totalCents;
  const start = data.history[0];
  const change = showChart && start ? describeChange(start.v, Number(shownValue) / 1e6) : null;

  const [dollars, cents] = displayUsd(shownValue).split('.');

  return (
    <>
      <View style={[styles.hero, { marginTop: theme.space.lg }]}>
        <Text variant="caption" tone="secondary">
          {scrubbed ? formatMoment(scrubbed.t) : 'Total value'}
        </Text>
        <View style={styles.amountRow}>
          <Text variant="balance" tabular>
            {dollars}
          </Text>
          <Text variant="balance" tone="tertiary" tabular>
            .{cents}
          </Text>
        </View>
        {change && start ? (
          <Text variant="caption" tone={change.tone} tabular>
            {change.text}
            <Text variant="caption" tone="tertiary">
              {'  '}
              {scrubbed ? `since ${formatDay(start.t)}` : periodLabel(start.t)}
            </Text>
          </Text>
        ) : null}
      </View>

      {showChart ? (
        <View style={{ marginTop: theme.space.lg }}>
          <ScrubChart
            points={data.history}
            width={chartWidth}
            onScrub={(index) => {
              setScrubIndex(index);
              onScrubbingChange?.(index !== null);
            }}
          />
          <Text variant="caption" tone="tertiary" style={[styles.center, { marginTop: theme.space.xs }]}>
            Hold and drag to look back
          </Text>
        </View>
      ) : null}

      {shaped.length > 1 ? (
        <View style={[styles.donut, { marginTop: theme.space.xl }]}>
          <PortfolioDonut
            slices={shaped.map((holding, i) => ({
              key: holding.key,
              value: Number(holding.usdCents),
              color: holding.key === 'other' ? theme.colors.borderStrong : slotColor(i, colors),
            }))}
          />
        </View>
      ) : null}

      <View style={{ marginTop: theme.space.xl, gap: theme.space.md }}>
        {/* Column names for the numbers; the two-line names explain themselves. */}
        <View style={styles.legendRow}>
          <View style={{ flex: 1 }} />
          <Text variant="caption" tone="tertiary">
            Value
          </Text>
          <Text variant="caption" tone="tertiary" style={styles.pct}>
            Share
          </Text>
        </View>
        {shaped.map((holding, i) => {
          const pct = data.totalCents > 0n ? (Number(holding.usdCents) / Number(data.totalCents)) * 100 : 0;
          const color = holding.key === 'other' ? theme.colors.borderStrong : slotColor(i, colors);
          return (
            <View key={holding.key} style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: color, borderRadius: theme.radius.pill }]} />
              <AssetName label={holding.label} where={'where' in holding ? holding.where : undefined} />
              <Text variant="body" tone="secondary">
                {displayUsd(holding.usdCents)}
              </Text>
              <Text variant="caption" tone="tertiary" style={styles.pct}>
                {pct.toFixed(pct >= 10 ? 0 : 1)}%
              </Text>
            </View>
          );
        })}

        {/* Real money, just not priceable right now — never folded into "Other". */}
        {unpriced.map((holding) => (
          <View key={holding.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: theme.colors.borderStrong, borderRadius: theme.radius.pill }]} />
            <AssetName label={holding.label} where={holding.where} />
            <Text variant="body" tone="secondary">
              {holding.amountText}
            </Text>
            <Text variant="caption" tone="tertiary" style={styles.pct}>
              —
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

/** A holding named in two lines: what it is, and beneath it, where it is. */
function AssetName({ label, where }: { label: string; where?: string | undefined }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="bodyStrong">{label}</Text>
      {where ? (
        <Text variant="caption" tone="tertiary">
          {where}
        </Text>
      ) : null}
    </View>
  );
}

/** A drawn USD figure back to 6-decimal base units, for display only. */
function usdFromNumber(value: number): bigint {
  return BigInt(Math.round(value * 1e6));
}

/** "+$12.34 (+2.1%)" in green, red for a fall, grey for no change. */
function describeChange(from: number, to: number): { text: string; tone: 'positive' | 'danger' | 'secondary' } {
  const diff = to - from;
  const cents = Math.round(diff * 100);
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  const amount = displayUsd(usdFromNumber(Math.abs(diff)));
  const pct = from > 0 ? ` (${sign}${Math.abs((diff / from) * 100).toFixed(Math.abs(diff / from) >= 0.1 ? 1 : 2)}%)` : '';

  return {
    text: `${sign}${amount}${pct}`,
    tone: cents > 0 ? 'positive' : cents < 0 ? 'danger' : 'secondary',
  };
}

function formatMoment(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** History only goes back as far as it was recorded; say so rather than claiming 30 days. */
function periodLabel(start: number): string {
  const days = Math.round((Date.now() - start) / 86_400_000);
  return days >= 29 ? 'past 30 days' : days >= 1 ? `since ${formatDay(start)}` : 'today';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  tabsWrap: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  tabs: {
    flexDirection: 'row',
    padding: TAB_PAD,
  },
  indicator: {
    position: 'absolute',
    top: TAB_PAD,
    left: TAB_PAD,
    bottom: TAB_PAD,
  },
  tabButtonWrap: {
    flex: 1,
  },
  tabButton: {
    paddingVertical: 8,
    alignItems: 'center',
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
  hero: {
    alignItems: 'center',
    gap: 2,
  },
  amountRow: {
    flexDirection: 'row',
  },
  donut: {
    alignItems: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  swatch: {
    width: 12,
    height: 12,
  },
  pct: {
    minWidth: 34,
    textAlign: 'right',
  },
});
