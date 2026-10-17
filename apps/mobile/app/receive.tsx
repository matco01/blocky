import { IS_TESTNET } from '@blocky/wallet-core';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { StatusBarCover } from '../components/StatusBarCover';
import { Text } from '../components/Text';
import { Tile } from '../components/Tile';
import { api } from '../lib/api';
import { homeChainName } from '../lib/chain';
import { usePushPermission } from '../lib/push';
import { useModalTopPadding } from '../lib/screenInsets';
import { useWallet } from '../lib/wallet';
import { useTheme } from '../theme';

/** Circle's faucet: free test dollars on Arc Testnet. */
const FAUCET_URL = 'https://faucet.circle.com';

/**
 * Receive — and, for someone new, how money gets into Blocky at all.
 *
 * Two ways in, easiest first. Friends on Blocky pay your @name: nothing to
 * copy, and no network to get wrong. From anywhere else — another wallet, an
 * exchange — it's USDC on Arc to your address. The network is said on the
 * screen, not just to a screen reader: it's the one thing a sender can get
 * wrong, and the one thing an exchange will ask.
 */
export default function ReceiveScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { address } = useWallet();
  const notifications = usePushPermission();

  // Undefined until known; null when they haven't picked one. A failed read
  // leaves it unknown, so nobody is told to pick a name they already have.
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.me().then((me) => setUsername(me.username ?? null), () => {});
  }, []);

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function shareAddress() {
    if (!address) return;
    void Share.share({ message: `My wallet for USDC on ${homeChainName}:\n${address}` }).catch(() => {});
  }

  function shareName() {
    if (!username) return;
    void Share.share({ message: `Pay me on Blocky: @${username}` }).catch(() => {});
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPadding, paddingBottom: theme.space.xl, gap: theme.space.xl },
        ]}
      >
        <ScreenHeader title="Receive" feature="leaf" subtitle="Get paid by your name, or by your address." onClose={() => router.back()} />

        {/* By name: the easy way, for anyone already on Blocky. */}
        {username !== undefined ? (
          <Tile style={{ padding: theme.space.lg, gap: theme.space.sm }}>
            <Text variant="label" tone="secondary">
              From friends on Blocky
            </Text>
            {username ? (
              <>
                <View style={styles.row}>
                  <Text variant="heading" style={{ flex: 1 }} numberOfLines={1} selectable>
                    @{username}
                  </Text>
                  <PressableScale onPress={shareName} accessibilityLabel="Share your name" style={styles.row}>
                    <Icon name="share-outline" size={18} tone="accent" />
                    <Text variant="label" tone="accent">
                      Share
                    </Text>
                  </PressableScale>
                </View>
                <Text variant="caption" tone="tertiary">
                  They pay your name — nothing to copy, nothing to get wrong.
                </Text>
              </>
            ) : (
              <>
                <Text variant="body" tone="secondary">
                  Pick a name, and friends can pay you without your address.
                </Text>
                <Button label="Pick a name" variant="secondary" size="compact" onPress={() => router.push('/username')} />
              </>
            )}
          </Tile>
        ) : null}

        {/* By address: from another wallet or an exchange. */}
        <View style={{ gap: theme.space.md }}>
          <Text variant="label" tone="secondary">
            From another wallet or an exchange
          </Text>

          {address ? (
            <View style={[styles.center, { gap: theme.space.md }]}>
              {/* Always dark-on-white, whatever the theme: scanners read contrast, not style. */}
              <Tile radius={theme.radius.xxl} style={{ backgroundColor: '#FFFFFF', padding: theme.space.lg }}>
                <QRCodeStyled data={address} pieceSize={6} pieceBorderRadius={2} color="#0B0B0F" />
              </Tile>

              <View style={[styles.pill, { backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.pill }]}>
                <Text variant="label" tone="accent">
                  USDC on {homeChainName}
                </Text>
              </View>

              <Tile muted radius={theme.radius.md} style={{ alignSelf: 'stretch', paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm }}>
                <Text variant="caption" style={styles.address} selectable accessibilityLabel={address}>
                  {grouped(address)}
                </Text>
              </Tile>

              <Text variant="caption" tone="tertiary" style={styles.centerText}>
                Send only USDC, on the {homeChainName} network. Sent on another network it still reaches your wallet,
                but has to be moved home before you can spend it.
              </Text>
            </View>
          ) : (
            <Text variant="body" tone="tertiary">
              Setting up your wallet…
            </Text>
          )}
        </View>

        {/* The moment to ask: they're waiting for money right now. */}
        {notifications.permission && notifications.permission !== 'on' ? (
          <PressableScale
            onPress={() => void notifications.turnOn()}
            accessibilityLabel="Turn on notifications"
            haptic="light"
            style={[styles.row, { gap: theme.space.sm }]}
          >
            <Icon name="notifications-outline" size={18} tone="accent" />
            <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
              {notifications.permission === 'off' ? 'Turn on notifications in Settings to hear when it lands' : 'Tell me the moment it arrives'}
            </Text>
            <Icon name="chevron-forward" size={18} tone="accent" />
          </PressableScale>
        ) : null}

        {IS_TESTNET ? (
          <PressableScale
            onPress={() => void WebBrowser.openBrowserAsync(FAUCET_URL)}
            accessibilityLabel="Get free test dollars"
            haptic="none"
            style={[styles.row, { gap: theme.space.sm }]}
          >
            <Icon name="water-outline" size={18} tone="accent" />
            <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
              Test dollars are free from Circle's faucet
            </Text>
            <Icon name="open-outline" size={18} tone="accent" />
          </PressableScale>
        ) : null}
      </ScrollView>

      <View style={[styles.row, { gap: theme.space.sm, paddingHorizontal: 24, paddingBottom: insets.bottom + theme.space.lg }]}>
        <View style={{ flex: 1 }}>
          <Button label={copied ? 'Copied' : 'Copy address'} onPress={copy} disabled={!address} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Share" variant="secondary" onPress={shareAddress} disabled={!address} />
        </View>
      </View>
      <StatusBarCover modal />
    </View>
  );
}

/**
 * "0x578c 01d4 e7e7 …" — in fours, so a person can check it against what
 * they pasted, the way they'd check a card number. Copying always copies the
 * address itself.
 */
function grouped(address: string): string {
  const groups = address.slice(2).match(/.{1,4}/g) ?? [];
  return `0x${groups.join(' ')}`;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  center: {
    alignItems: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  address: {
    fontFamily: MONO,
    textAlign: 'center',
    letterSpacing: 0.5,
    lineHeight: 20,
  },
});
