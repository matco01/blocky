import { displayUsd } from '@blocky/shared';
import { StyleSheet, View } from 'react-native';
import type { ActivityItem } from '../lib/api';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

/**
 * One line of history, written for a person: "Sent to 0x5a30…0003", not a
 * method selector and a hash.
 */
export function ActivityRow({ item }: { item: ActivityItem }) {
  const theme = useTheme();

  const sent = item.direction === 'sent';
  const failed = item.status === 'reverted';

  const title = sent ? `Sent to ${short(item.counterparty)}` : `Received from ${short(item.counterparty)}`;
  const amount = `${sent ? '−' : '+'}${displayUsd(item.amount)}`;

  return (
    <View style={[styles.row, { paddingVertical: theme.space.md }]}>
      <View style={[styles.square, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md }]}>
        <Icon name={sent ? 'arrow-up' : 'arrow-down'} size={20} tone={sent ? 'secondary' : 'positive'} />
      </View>

      <View style={styles.middle}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone={failed ? 'danger' : 'tertiary'}>
          {failed ? 'Failed — nothing was sent' : item.status === 'pending' ? 'Confirming…' : when(item.timestamp)}
        </Text>
      </View>

      <Text
        variant="bodyStrong"
        tone={failed ? 'tertiary' : sent ? 'primary' : 'positive'}
        tabular
        style={failed ? styles.struck : undefined}
      >
        {amount}
      </Text>
    </View>
  );
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  struck: {
    textDecorationLine: 'line-through',
  },
});
