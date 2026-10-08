import { useLoginWithEmail, useLoginWithOAuth } from '@privy-io/expo';
import { useLoginWithPasskey } from '@privy-io/expo/passkey';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { IntroHero } from '../components/IntroHero';
import { TextField } from '../components/TextField';
import { config } from '../lib/config';
import { useTheme } from '../theme';

/**
 * Sign in.
 *
 * No seed phrase, no "write these 12 words down". An email code today; a
 * passkey (Face ID) once a relying-party domain is configured. The wallet is
 * created behind the scenes on first login.
 *
 * Opens with Blocky arriving (see `IntroHero`). The form is laid out from the
 * start — invisible, not absent — so the hero's resting place is already
 * known when the intro measures where to glide to, and nothing shifts when
 * the form fades in.
 */
export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { loginWithPasskey } = useLoginWithPasskey();
  const { login: loginWithOAuth } = useLoginWithOAuth();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reduced = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const reveal = useCallback(() => {
    revealedRef.current = true;
    setRevealed(true);
  }, []);
  const [skipped, setSkipped] = useState(false);
  const form = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!revealed || reduced) return;
    form.value = withDelay(80, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [revealed, reduced, form]);

  // An animation started while the app was in the background can stall on
  // Android and leave the form invisible. Coming back, show it outright.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setSkipped(true);
      } else if (revealedRef.current) {
        cancelAnimation(form);
        form.value = 1;
      }
    });
    return () => subscription.remove();
  }, [form]);

  const formStyle = useAnimatedStyle(() => ({
    opacity: form.value,
    transform: [{ translateY: (1 - form.value) * 24 }],
  }));

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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <IntroHero skipped={skipped} onReveal={reveal} />

        <Animated.View style={[{ gap: theme.space.lg }, formStyle]} pointerEvents={revealed ? 'auto' : 'none'}>
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
                variant="ink"
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
                variant="ink"
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

          {stage === 'email' ? (
            <Button
              label="Continue with Google"
              variant="secondary"
              loading={busy}
              onPress={() => run(() => loginWithOAuth({ provider: 'google' }))}
            />
          ) : null}

          {config.passkeyRelyingParty && stage === 'email' ? (
            <Button
              label="Sign in with a passkey"
              variant="secondary"
              onPress={() =>
                run(() => loginWithPasskey({ relyingParty: config.passkeyRelyingParty as string }))
              }
            />
          ) : null}
        </Animated.View>
      </ScrollView>

      {/* While he's arriving, a tap anywhere skips straight to the form. */}
      {revealed ? null : (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setSkipped(true)}
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
});
