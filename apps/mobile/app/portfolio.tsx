import { displayUsd, formatUnits, parseUsd } from '@blocky/shared';
import { CHAINS } from '@blocky/wallet-core';
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
import { HistoryChart } from '../components/HistoryChart';
import { PortfolioDonut } from '../components/PortfolioDonut';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { Tile } from '../components/Tile';
import { api, type BalanceHistory } from '../lib/api';
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
  label: string;
  /** null when we have no price for this asset — real money, just not priceable right now. */
  usdCents: bigint | null;
  /** Shown instead of a dollar amount when `usdCents` is null. */
  amountText?: string;
}

interface TabData {
  holdings: Holding[];
  totalCents: bigint;
  history: number[];
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; spendable: TabData; investments: TabData }
  | { state: 'error'; message: string };

/** Everything the wallet holds, split the way the money actually behaves: spendable stablecoins versus everything else. */
export default function PortfolioScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('spendable');

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
        spendableHoldings.push({ key: `chain-${balance.chainId}`, label: chainName(balance.chainId), usdCents: arcCents });
      }

      const gatewayChains = [...(balance.gateway?.perChain ?? [])].sort((a, b) => a.chainId - b.chainId);
      for (const entry of gatewayChains) {
        const cents = parseUsd(entry.balanceUsd);
        if (cents > 0n) spendableHoldings.push({ key: `chain-${entry.chainId}`, label: chainName(entry.chainId), usdCents: cents });
      }

      const investmentHoldings: Holding[] = balance.otherHoldings.map((holding) => {
        const key = `token-${holding.chainId}-${holding.symbol}`;
        const label = `${holding.symbol} · ${chainName(holding.chainId)}`;
        return holding.usd
          ? { key, label, usdCents: parseUsd(holding.usd) }
          : { key, label, usdCents: null, amountText: formatTokenAmount(holding.amount, holding.decimals) };
      });

      const spendableTotal = parseUsd(balance.totalUsd) + parseUsd(balance.gateway?.totalUsd ?? '0');
      const investmentsTotal = investmentHoldings.reduce((sum, h) => sum + (h.usdCents ?? 0n), 0n);

      setLoad({
        state: 'ready',
        spendable: {
          holdings: spendableHoldings,
          totalCents: spendableTotal,
          history: historyResult.snapshots.map((s) => Number(s.spendableUsd)),
        },
        investments: {
          holdings: investmentHoldings,
          totalCents: investmentsTotal,
          history: historyResult.snapshots.map((s) => Number(s.investmentsUsd)),
        },
      });
    } catch (error) {
      setLoad({ state: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchPortfolio();
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
      <View style={[styles.header, { paddingTop: theme.space.xl }]}>
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
  emptyTitle,
  emptySubtitle,
}: {
  data: TabData;
  colors: readonly string[];
  chartWidth: number;
  emptyTitle: string;
  emptySubtitle: string;
}) {
  const theme = useTheme();

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

  const [dollars, cents] = displayUsd(data.totalCents).split('.');

  return (
    <>
      <View style={[styles.hero, { marginTop: theme.space.lg }]}>
        <Text variant="caption" tone="secondary">
          Total value
        </Text>
        <View style={styles.amountRow}>
          <Text variant="balance">{dollars}</Text>
          <Text variant="balance" tone="tertiary">
            .{cents}
          </Text>
        </View>
      </View>

      {data.history.length >= 2 ? (
        <View style={{ marginTop: theme.space.lg }}>
          <HistoryChart values={data.history} width={chartWidth} />
          <Text variant="caption" tone="tertiary" style={styles.center}>
            Last 30 days
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

      <View style={{ marginTop: theme.space.xl, gap: theme.space.sm }}>
        {shaped.map((holding, i) => {
          const pct = data.totalCents > 0n ? (Number(holding.usdCents) / Number(data.totalCents)) * 100 : 0;
          const color = holding.key === 'other' ? theme.colors.borderStrong : slotColor(i, colors);
          return (
            <View key={holding.key} style={styles.legendRow}>
              <View style={[styles.swatch, { backgroundColor: color, borderRadius: theme.radius.pill }]} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {holding.label}
              </Text>
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
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {holding.label}
            </Text>
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
