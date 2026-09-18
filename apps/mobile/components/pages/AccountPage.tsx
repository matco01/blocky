import { displayUsd, type Policy } from '@blocky/shared';
import { usePrivy } from '@privy-io/expo';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../lib/api';
import { useSmartAccount } from '../../lib/smart-account';
import { useTheme, type Appearance } from '../../theme';
import { BlockyCard } from '../BlockyCard';
import { PageDots, type PageProps } from '../PageDots';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

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

  function chooseAppearance() {
    Alert.alert('Appearance', undefined, [
      { text: APPEARANCE_LABELS.system, onPress: () => theme.setAppearance('system') },
      { text: APPEARANCE_LABELS.dark, onPress: () => theme.setAppearance('dark') },
      { text: APPEARANCE_LABELS.light, onPress: () => theme.setAppearance('light') },
    ]);
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
        <Text variant="bodyStrong">Account</Text>
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
          label="Address"
          value={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Setting up…'}
          action={copied ? 'Copied' : 'Copy'}
          onPress={address ? copyAddress : undefined}
        />
        <Row label="Network" value="Arc Testnet" />
        <Row
          label="Spending limits"
          value={policy ? `${displayUsd(policy.perTxCapUsd)} per send · ${displayUsd(policy.dailyCapUsd)} a day` : '—'}
          chevron
          onPress={() => router.push('/limits')}
        />
      </Section>

      {/* --- Preferences ---------------------------------------------------- */}
      <Section title="Preferences">
        <Row label="Appearance" value={APPEARANCE_LABELS[theme.appearance]} chevron onPress={chooseAppearance} />
      </Section>

      {/* --- Security ------------------------------------------------------- */}
      <Section title="Security">
        <Row label="Export private key" value="Coming soon" chevron onPress={explainExport} />
      </Section>

      {/* --- Sign out ------------------------------------------------------- */}
      <View style={{ marginTop: theme.space.xxl, alignItems: 'center', gap: theme.space.lg }}>
        <PressableScale onPress={confirmSignOut} accessibilityLabel="Sign out" haptic="none">
          <Text variant="bodyStrong" tone="danger">
            Sign out
          </Text>
        </PressableScale>
        <Text variant="caption" tone="tertiary">
          Blocky {version}
        </Text>
      </View>
    </ScrollView>
  );
}

const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: 'Same as phone',
  light: 'Light',
  dark: 'Dark',
};

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={{ marginTop: theme.space.xxl, gap: theme.space.sm }}>
      <Text variant="label" tone="tertiary" style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={[styles.group, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg }]}>
        {children}
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  action,
  chevron,
  onPress,
}: {
  label: string;
  value: string;
  /** A short action word on the right, e.g. "Copy". */
  action?: string;
  chevron?: boolean;
  onPress?: (() => void) | undefined;
}) {
  const theme = useTheme();

  const body = (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <View style={styles.rowText}>
        <Text variant="body">{label}</Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {value}
        </Text>
      </View>
      {action ? (
        <Text variant="label" tone="accent">
          {action}
        </Text>
      ) : null}
      {chevron ? (
        <Text variant="heading" tone="tertiary">
          ›
        </Text>
      ) : null}
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

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
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
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: 4,
  },
  group: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
});
