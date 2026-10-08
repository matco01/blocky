import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { Tile } from '../components/Tile';
import { useWallet } from '../lib/wallet';
import { homeChainName } from '../lib/chain';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

/**
 * Receive.
 *
 * An address, a QR code, and a copy button. The one piece of chain detail the
 * user genuinely needs is here: which network to send on.
 */
export default function ReceiveScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { address } = useWallet();

  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.colors.background,
          paddingTop: topPadding,
          paddingBottom: insets.bottom + theme.space.xl,
        },
      ]}
    >
      <ScreenHeader
        title="Receive"
        feature="leaf"
        subtitle={`Send USDC on ${homeChainName} to this address.`}
        onClose={() => router.back()}
      />

      <View style={styles.middle}>
        {address ? (
          <>
            {/* Always dark-on-white, whatever the theme: scanners read contrast, not style. */}
            <Tile radius={theme.radius.xxl} style={[styles.qr, { backgroundColor: '#FFFFFF', padding: theme.space.lg }]}>
              <QRCodeStyled data={address} pieceSize={7} pieceBorderRadius={2} color="#0B0B0F" />
            </Tile>

            <Tile muted radius={theme.radius.md} style={{ paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm }}>
              <Text variant="caption" tabular style={styles.address} selectable>
                {address}
              </Text>
            </Tile>
          </>
        ) : (
          <Text variant="body" tone="tertiary">
            Setting up your wallet…
          </Text>
        )}
      </View>

      <View style={{ gap: theme.space.md }}>
        <Button label={copied ? 'Copied' : 'Copy address'} onPress={copy} disabled={!address} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  middle: {
    alignItems: 'center',
    gap: 20,
  },
  qr: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  address: {
    textAlign: 'center',
  },
});
