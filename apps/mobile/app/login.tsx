import { useLoginWithEmail } from '@privy-io/expo';
import { useLoginWithPasskey } from '@privy-io/expo/passkey';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Mascot } from '../components/Mascot';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { config } from '../lib/config';
import { useTheme } from '../theme';

/**
 * Sign in.
 *
 * No seed phrase, no "write these 12 words down". An email code today; a
 * passkey (Face ID) once a relying-party domain is configured. The wallet is
 * created behind the scenes on first login.
 */
export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { loginWithPasskey } = useLoginWithPasskey();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
      <View style={[styles.content, { paddingTop: insets.top + 96, paddingBottom: insets.bottom + 24 }]}>
        <View style={{ alignItems: 'center', gap: theme.space.lg }}>
          <Mascot pose="neutral" size={112} />
          <View style={{ alignItems: 'center', gap: theme.space.sm }}>
            <Text variant="title">Blocky</Text>
            <Text variant="body" tone="secondary" style={styles.center}>
              Your money, and an assistant that moves it for you.
            </Text>
          </View>
        </View>

        <View style={{ gap: theme.space.lg }}>
          {stage === 'email' ? (
            <>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                error={error}
              />
              <Button
                label="Continue"
                disabled={!emailValid}
                loading={busy}
                onPress={() => run(async () => {
                  await sendCode({ email: email.trim() });
                  setStage('code');
                })}
              />
            </>
          ) : (
            <>
              <TextField
                label={`Code sent to ${email.trim()}`}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                autoFocus
                error={error}
              />
              <Button
                label="Sign in"
                disabled={code.length !== 6}
                loading={busy}
                haptic="medium"
                onPress={() => run(() => loginWithCode({ code, email: email.trim() }))}
              />
              <Button
                label="Use a different email"
                variant="quiet"
                onPress={() => {
                  setStage('email');
                  setCode('');
                  setError(null);
                }}
              />
            </>
          )}

          {config.passkeyRelyingParty && stage === 'email' ? (
            <Button
              label="Sign in with a passkey"
              variant="secondary"
              onPress={() =>
                run(() => loginWithPasskey({ relyingParty: config.passkeyRelyingParty as string }))
              }
            />
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  center: {
    textAlign: 'center',
  },
});
