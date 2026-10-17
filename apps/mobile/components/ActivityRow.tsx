import { displayUsd, shortAddress } from '@blocky/shared';
import { STOCK_CHAIN, getChain, stockBySymbol } from '@blocky/wallet-core';
import { StyleSheet, View } from 'react-native';
import type { ActivityItem, AssetLine } from '../lib/api';
import { useTheme } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** What kind of thing happened, from what left and what arrived. */
export type ActivityKind = 'sent' | 'received' | 'bought' | 'sold' | 'swapped' | 'moved';

/**
 * One row of history in words, shared by the row and its detail sheet: "Bought
 * AAPL", "Moved to Base", "Sent to @sam" — never a method selector and a hash.
 */
export function describe(item: ActivityItem): { kind: ActivityKind; title: string; icon: IconName } {
  const { sent, received, party } = item.details ?? { sent: null, received: null, party: null };
  const outsider = shortAddress(item.counterparty);

  if (item.direction === 'received') {
    // The server's own words when there's nobody to name: money minted in from another chain.
    return { kind: 'received', title: item.title ?? `Received from ${party ?? outsider}`, icon: 'arrow-down' };
  }

  // A move or a trade: something left, something else (or the same thing elsewhere) arrived.
  if (sent && received && party?.startsWith('Your wallet')) {
    if (sent.symbol === received.symbol) return { kind: 'moved', title: `Moved to ${received.chain}`, icon: 'git-compare-outline' };
    if (sent.symbol === 'USDC') return { kind: 'bought', title: `Bought ${assetName(received)}`, icon: 'trending-up' };
    if (received.symbol === 'USDC') return { kind: 'sold', title: `Sold ${assetName(sent)}`, icon: 'trending-down' };
    return { kind: 'swapped', title: `Swapped ${assetName(sent)} for ${assetName(received)}`, icon: 'swap-horizontal' };
  }

  return { kind: 'sent', title: item.title ?? `Sent to ${party ?? outsider}`, icon: 'arrow-up' };
}

const STOCK_CHAIN_NAME = getChain(STOCK_CHAIN).name;

/**
 * "Apple", not "AAPL": a listed stock by the company's name, the way people
 * say it. Only on the chain stocks live on — anyone can call a token "AAPL"
 * anywhere else, and that one stays its symbol.
 */
function assetName(line: AssetLine): string {
  return (line.chain === STOCK_CHAIN_NAME ? stockBySymbol(line.symbol)?.name : null) ?? line.symbol;
}

/**
 * One line of history. Tapping it opens the detail sheet: what moved, where,
 * to whom, what it cost, and the transaction itself.
 */
export function ActivityRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  const theme = useTheme();
  const { kind, title, icon } = describe(item);

  const incoming = kind === 'received';
  const failed = item.status === 'reverted';
  // A trade isn't money leaving: the dollars became something else of yours.
  const sign = incoming ? '+' : kind === 'sent' ? '−' : '';
  const amount = `${sign}${displayUsd(item.amount)}`;
  const secondary =
    item.details?.received && kind !== 'sent' && kind !== 'received' && kind !== 'moved'
      ? `${trim(item.details.received.amount)} ${item.details.received.symbol}`
      : null;

  return (
    <PressableScale onPress={onPress} disabled={!onPress} haptic="none" scaleTo={0.98} accessibilityLabel={`${title}, ${amount}`}>
      <View style={[styles.row, { paddingVertical: theme.space.md }]}>
        <View style={[styles.square, { backgroundColor: incoming ? theme.colors.accentTint : theme.colors.surfaceMuted, borderRadius: theme.radius.md }]}>
          <Icon name={icon} size={20} tone={incoming ? 'positive' : 'secondary'} />
        </View>

        <View style={styles.middle}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone={failed ? 'danger' : 'tertiary'} numberOfLines={1}>
            {failed ? 'Failed — nothing was sent' : item.status === 'pending' ? 'Confirming…' : when(item.timestamp)}
          </Text>
        </View>

        <View style={styles.right}>
          <Text
            variant="bodyStrong"
            tone={failed ? 'tertiary' : incoming ? 'positive' : 'primary'}
            tabular
            style={failed ? styles.struck : undefined}
          >
            {amount}
          </Text>
          {secondary ? (
            <Text variant="caption" tone="tertiary" tabular numberOfLines={1}>
              {secondary}
            </Text>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

/** "0.002006100000" → "0.0020061": a token amount without the trailing zeros. */
export function trim(amount: string): string {
  return amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount;
}

/**
 * When, under a day heading that already says which day: "Just now", "12 min
 * ago", then the time — never the date again.
 */
function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  square: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  right: {
    alignItems: 'flex-end',
    gap: 2,
    maxWidth: '45%',
  },
  struck: {
    textDecorationLine: 'line-through',
  },
});
