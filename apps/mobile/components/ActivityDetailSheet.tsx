import { displayUsd, shortAddress } from '@blocky/shared';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ActivityItem, AssetLine } from '../lib/api';
import { useTheme } from '../theme';
import { describe, trim } from './ActivityRow';
import { Button } from './Button';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/**
 * Everything about one row of history, in words: what left, what arrived and
 * where, who was on the other side, what it cost, when, and the transaction
 * itself for anyone who wants to check it on an explorer.
 */
export function ActivityDetailSheet({ item, onClose }: { item: ActivityItem | null; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.scrim, { backgroundColor: theme.colors.scrim }]} onPress={onClose} accessibilityLabel="Close" />
      {item ? (
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: theme.radius.xxl,
              borderTopRightRadius: theme.radius.xxl,
              paddingBottom: insets.bottom + theme.space.lg,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <ScrollView contentContainerStyle={{ padding: theme.space.xl, paddingTop: theme.space.md, gap: theme.space.xl }}>
            <Details item={item} />
            <Button label="Done" variant="secondary" onPress={onClose} />
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

function Details({ item }: { item: ActivityItem }) {
  const theme = useTheme();
  const { kind, title, icon } = describe(item);
  const details = item.details;
  const incoming = kind === 'received';
  const failed = item.status === 'reverted';
  const sign = incoming ? '+' : kind === 'sent' ? '−' : '';

  const status = failed
    ? { label: 'Failed — nothing was sent', tone: 'danger' as const, tint: theme.colors.dangerTint }
    : item.status === 'pending'
      ? { label: 'Confirming', tone: 'warning' as const, tint: theme.colors.warningTint }
      : { label: 'Completed', tone: 'positive' as const, tint: theme.colors.accentTint };

  return (
    <View style={{ gap: theme.space.xl }}>
      {/* The headline: what it was, how much, and whether it went through. */}
      <View style={styles.top}>
        <View style={[styles.square, { backgroundColor: incoming ? theme.colors.accentTint : theme.colors.surfaceMuted, borderRadius: theme.radius.lg }]}>
          <Icon name={icon} size={26} tone={incoming ? 'positive' : 'primary'} />
        </View>
        <Text variant="heading" style={styles.center}>
          {title}
        </Text>
        <Text variant="display" tone={failed ? 'tertiary' : incoming ? 'positive' : 'primary'} style={failed ? styles.struck : undefined}>
          {sign}
          {displayUsd(item.amount)}
        </Text>
        <View style={[styles.pill, { backgroundColor: status.tint, borderRadius: theme.radius.sm }]}>
          <Text variant="label" tone={status.tone}>
            {status.label}
          </Text>
        </View>
      </View>

      {/* What moved, and where. */}
      <Group>
        {details?.sent ? <Row label={kind === 'sent' || kind === 'moved' ? 'You sent' : 'You paid'} value={asset(details.sent)} /> : null}
        {details?.received && kind !== 'sent' ? <Row label="You got" value={asset(details.received)} /> : null}
        {kind === 'sent' && details?.received && details.received.symbol !== details.sent?.symbol ? (
          <Row label="They got" value={asset(details.received)} />
        ) : null}
        <Row
          label={incoming ? 'From' : kind === 'sent' ? 'To' : 'Where'}
          value={details?.party ?? shortAddress(item.counterparty)}
          detail={details?.party && !details.party.startsWith('Your wallet') ? shortAddress(item.counterparty) : undefined}
          copy={kind === 'sent' || incoming ? item.counterparty : undefined}
        />
      </Group>

      {/* What it cost and how it got there. */}
      <Group>
        {details?.feeUsd ? <Row label="Fees" value={displayUsd(details.feeUsd)} /> : null}
        <Row label="Network" value={details?.network ?? 'Arc'} />
        {details?.via ? <Row label="Carried by" value={details.via} /> : null}
        <Row label="When" value={fullDate(item.timestamp)} />
        {details?.origin ? <Row label="Made from" value={details.origin === 'agent' ? 'Chat with Blocky' : 'Send screen'} /> : null}
      </Group>

      {item.summary ? (
        <Text variant="body" tone="secondary">
          {item.summary}
        </Text>
      ) : null}

      {/* The transaction itself. */}
      <Group>
        <Row label="Transaction" value={shortAddress(item.txHash)} copy={item.txHash} />
        {details?.explorerUrl ? (
          <PressableScale
            onPress={() => void WebBrowser.openBrowserAsync(details.explorerUrl)}
            accessibilityLabel="View on the block explorer"
            haptic="none"
            style={[styles.row, { paddingVertical: theme.space.md }]}
          >
            <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
              View on the block explorer
            </Text>
            <Icon name="open-outline" size={18} tone="accent" />
          </PressableScale>
        ) : null}
      </Group>
    </View>
  );
}

/** A tile of label/value rows, separated by hairlines. */
function Group({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const rows = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  if (rows.length === 0) return null;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.stroke,
        borderRadius: theme.radius.xl,
        paddingHorizontal: theme.space.lg,
      }}
    >
      {rows.map((row, index) => (
        <View key={index} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border } : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

function Row({ label, value, detail, copy }: { label: string; value: string; detail?: string | undefined; copy?: string | undefined }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  return (
    <View style={[styles.row, { paddingVertical: theme.space.md, gap: theme.space.md }]}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <View style={styles.value}>
        <Text variant="bodyStrong" style={styles.right} numberOfLines={2}>
          {value}
        </Text>
        {detail ? (
          <Text variant="caption" tone="tertiary" style={styles.right}>
            {detail}
          </Text>
        ) : null}
      </View>
      {copy ? (
        <PressableScale
          onPress={async () => {
            await Clipboard.setStringAsync(copy);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          haptic="none"
          scaleTo={0.9}
        >
          <Icon name={copied ? 'checkmark' : 'copy-outline'} size={18} tone={copied ? 'positive' : 'tertiary'} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** "0.002006 ETH on Base · $4.99" — the dollar value only when it adds something. */
function asset(line: AssetLine): string {
  const usd = line.usd && line.symbol !== 'USDC' ? ` · ${displayUsd(line.usd)}` : '';
  return `${trim(line.amount)} ${line.symbol} on ${line.chain}${usd}`;
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
  },
  top: {
    alignItems: 'center',
    gap: 8,
  },
  square: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  value: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  right: {
    textAlign: 'right',
  },
  center: {
    textAlign: 'center',
  },
  struck: {
    textDecorationLine: 'line-through',
  },
});
