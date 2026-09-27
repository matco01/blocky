import { displayUsd } from '@blocky/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Text } from '../../components/Text';
import { Tile } from '../../components/Tile';
import { api, type PaymentRequest } from '../../lib/api';
import { payRequest } from '../../lib/requests';
import { useModalTopPadding } from '../../lib/screenInsets';
import { useTheme } from '../../theme';

/**
 * A pay link — blocky://pay/<id> — opened: who is asking, for how much and
 * what, and a button to pay it. Paying goes through Send like anything else.
 */
export default function PayLinkScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.paymentRequest(id).then(setRequest, (cause) => setMessage(cause instanceof Error ? cause.message : 'That request is gone.'));
  }, [id]);

  async function pay() {
    if (!request) return;
    setPaying(true);
    setMessage(null);
    try {
      await payRequest(request.id);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not prepare that payment.');
    } finally {
      setPaying(false);
    }
  }

  const who = request?.requesterUsername ? `@${request.requesterUsername}` : 'Someone';

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: topPadding, paddingBottom: insets.bottom + theme.space.xl }]}>
      <ScreenHeader title="Pay request" onClose={() => router.back()} />

      {!request && !message ? <ActivityIndicator style={{ marginTop: theme.space.xxl }} color={theme.colors.textTertiary} /> : null}

      {request ? (
        <Tile style={{ padding: theme.space.xl, gap: theme.space.sm, marginTop: theme.space.xl, alignItems: 'center' }}>
          <Text variant="body" tone="secondary">
            {who} is asking for
          </Text>
          <Text variant="balance">{displayUsd(request.amountUsd)}</Text>
          {request.note ? (
            <Text variant="body" tone="secondary">
              for {request.note}
            </Text>
          ) : null}
          {request.status !== 'open' ? (
            <Text variant="bodyStrong" tone="tertiary" style={{ marginTop: theme.space.sm }}>
              {request.status === 'paid' ? 'Already paid' : request.status === 'declined' ? 'Declined' : 'Cancelled'}
            </Text>
          ) : null}
        </Tile>
      ) : null}

      {message ? (
        <Text variant="body" tone="warning" style={[styles.center, { marginTop: theme.space.lg }]}>
          {message}
        </Text>
      ) : null}

      <View style={{ marginTop: 'auto', gap: theme.space.md }}>
        {request?.status === 'open' ? <Button label={`Pay ${displayUsd(request.amountUsd)}`} haptic="heavy" loading={paying} onPress={() => void pay()} /> : null}
        <Button label="Close" variant="quiet" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  center: { textAlign: 'center' },
});
