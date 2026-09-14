import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { useSmartAccount } from '../lib/smart-account';
import { useTheme } from '../theme';

/**
 * Receive.
 *
 * An address, a QR code, and a copy button. The one piece of chain detail the
 * user genuinely needs is here: which network to send on. Getting that wrong
 * doesn't lose the money — it's the same address on every EVM chain — but it
 * lands somewhere this app doesn't show yet, which feels exactly like losing it.
 */
export default function ReceiveScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { address } = useSmartAccount();

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
          paddingTop: theme.space.xl,
          paddingBottom: insets.bottom + theme.space.xl,
        },
      ]}
    >
      <View style={{ gap: theme.space.sm }}>
        <Text variant="title">Receive</Text>
        <Text variant="body" tone="secondary">
          Send USDC on Arc Testnet to this address.
        </Text>
      </View>

      <View style={styles.middle}>
        {address ? (
          <>
            <View
              style={[
                styles.qr,
                { backgroundColor: '#FFFFFF', borderRadius: theme.radius.xl, padding: theme.space.lg },
              ]}
            >
              {/* Always dark-on-white, whatever the theme: scanners read contrast, not style. */}
              <QRCodeStyled data={address} pieceSize={7} pieceBorderRadius={2} color="#0B0B0F" />
            </View>

            <Text variant="body" tabular style={styles.address} selectable>
              {address}
            </Text>
          </>
        ) : (
          <Text variant="body" tone="tertiary">
            Setting up your wallet…
          </Text>
        )}
      </View>

      <View style={{ gap: theme.space.md }}>
        <Button label={copied ? 'Copied' : 'Copy address'} onPress={copy} disabled={!address} />
        <Button label="Done" variant="quiet" onPress={() => router.back()} />
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
    paddingHorizontal: 12,
  },
});
