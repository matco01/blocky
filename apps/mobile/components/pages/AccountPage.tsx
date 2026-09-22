import { displayUsd, type Policy } from '@blocky/shared';
import { usePrivy } from '@privy-io/expo';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../lib/api';
import { useSmartAccount } from '../../lib/smart-account';
import { useTheme } from '../../theme';
import { BlockyCard } from '../BlockyCard';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { PageDots, type PageProps } from '../PageDots';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { Tile } from '../Tile';

/**
 * Account — the second page of the pager, one swipe left of Home.
 *
 * Everything about the wallet that isn't moving money: the card, the address,
 * limits, security, and signing out. Things that aren't built yet say so
 * plainly rather than leading somewhere that doesn't work.
 */
export function AccountPage({ page, onPageChange }: PageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout } = usePrivy();
  const { address } = useSmartAccount();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [copied, setCopied] = useState(false);

  // Limits can change on the Limits screen; re-read whenever this page returns.
  useFocusEffect(
    useCallback(() => {
      api.getPolicy().then(setPolicy, () => setPolicy(null));
    }, []),
  );

  const email = user?.linked_accounts.find((account) => account.type === 'email');
  const version = Constants.expoConfig?.version ?? '—';

  async function copyAddress() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function explainExport() {
    Alert.alert(
      'Export private key',
      "This will let you move your wallet to another app, like MetaMask. For your safety it runs in a secure page from our wallet provider rather than inside the app, and that page isn't set up yet.",
    );
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in with your email.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.space.sm, paddingBottom: insets.bottom + theme.space.xxl },
      ]}
    >
      <View style={styles.header}>
        <Text variant="title">Account</Text>
        <View style={styles.dots} pointerEvents="box-none">
          <PageDots page={page} onPageChange={onPageChange} />
        </View>
      </View>

      {email && 'address' in email ? (
        <Text variant="body" tone="secondary" style={{ marginTop: theme.space.xs }}>
          {email.address}
        </Text>
      ) : null}

      {/* --- Card ----------------------------------------------------------- */}
      <View style={{ marginTop: theme.space.xl, gap: theme.space.md }}>
        <BlockyCard />
        <Text variant="caption" tone="tertiary" style={styles.center}>
          A card that spends your USDC anywhere cards are accepted. Coming soon.
        </Text>
      </View>

      {/* --- Wallet --------------------------------------------------------- */}
      <Section title="Wallet">
        <Row
          icon="wallet-outline"
          label="Address"
          value={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Setting up…'}
          action={copied ? 'Copied' : 'Copy'}
          onPress={address ? copyAddress : undefined}
        />
        <Row icon="globe-outline" label="Network" value="Arc Testnet" />
        <Row icon="receipt-outline" label="Activity" value="Everything sent and received" chevron onPress={() => router.push('/activity')} />
        <Row
          icon="shield-checkmark-outline"
          label="Spending limits"
          value={policy ? `${displayUsd(policy.perTxCapUsd)} per send · ${displayUsd(policy.dailyCapUsd)} a day` : '—'}
          chevron
          onPress={() => router.push('/limits')}
          last
        />
      </Section>

      {/* --- Preferences ---------------------------------------------------- */}
      <Section title="Preferences">
        <ToggleRow
          icon="color-palette-outline"
          label="Dark mode"
          value={theme.appearance === 'dark'}
          onValueChange={(value) => theme.setAppearance(value ? 'dark' : 'light')}
          last
        />
      </Section>

      {/* --- Security ------------------------------------------------------- */}
      <Section title="Security">
        <Row icon="key-outline" label="Export private key" value="Coming soon" chevron onPress={explainExport} last />
      </Section>

      {/* --- Sign out ------------------------------------------------------- */}
      <View style={{ marginTop: theme.space.xxl, gap: theme.space.lg, alignItems: 'center' }}>
        <View style={{ alignSelf: 'stretch' }}>
          <Button label="Sign out" variant="danger" haptic="none" onPress={confirmSignOut} />
        </View>
        <Text variant="caption" tone="tertiary">
          Blocky {version}
        </Text>
      </View>
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={{ marginTop: theme.space.xl, gap: theme.space.sm }}>
      <Text variant="label" tone="secondary" style={{ paddingHorizontal: 4 }}>
        {title}
      </Text>
      <Tile style={{ overflow: 'hidden' }}>{children}</Tile>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  action,
  chevron,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  value: string;
  /** A short action word on the right, e.g. "Copy". */
  action?: string;
  chevron?: boolean;
  onPress?: (() => void) | undefined;
  last?: boolean;
}) {
  const theme = useTheme();

  const body = (
    <View style={[styles.row, { borderBottomColor: theme.colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <View style={[styles.iconSquare, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm }]}>
        <Icon name={icon} size={18} tone="secondary" />
      </View>
      <View style={styles.rowText}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {value}
        </Text>
      </View>
      {action ? (
        <Text variant="label" tone="accent">
          {action}
        </Text>
      ) : null}
      {chevron ? <Icon name="chevron-forward" size={18} tone="tertiary" /> : null}
    </View>
  );

  return onPress ? (
    <PressableScale onPress={onPress} accessibilityLabel={label} haptic="light" scaleTo={0.99}>
      {body}
    </PressableScale>
  ) : (
    body
  );
}

/** A row that ends in a switch instead of a chevron — the native thumb already slides, no extra animation needed. */
function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
  last,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  last?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border, borderBottomWidth: last ? 0 : 1 }]}>
      <View style={[styles.iconSquare, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm }]}>
        <Icon name={icon} size={18} tone="secondary" />
      </View>
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
        thumbColor={theme.colors.background}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
  },
  dots: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconSquare: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
});
