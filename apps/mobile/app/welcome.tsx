import { usePrivy } from '@privy-io/expo';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Mascot } from '../components/Mascot';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { ApiError, api } from '../lib/api';
import { finishOnboarding } from '../lib/onboarding';
import { useTheme } from '../theme';

const PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

type Availability = 'idle' | 'checking' | 'free' | 'taken';

/**
 * Right after signing up: pick the @name friends pay you by. One field, a
 * suggestion from their email, and a live check that it's free.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = usePrivy();

  const email = user?.linked_accounts.find((account) => account.type === 'email');
  const suggestion = email && 'address' in email ? suggest(String(email.address)) : '';

  const [name, setName] = useState(suggestion);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef('');

  const clean = name.trim().replace(/^@/, '').toLowerCase();
  const valid = PATTERN.test(clean);

  // Is it free? Asked a moment after they stop typing; only the latest answer counts.
  useEffect(() => {
    if (!valid) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    latest.current = clean;
    const timer = setTimeout(() => {
      api.lookupUser(clean).then(
        () => latest.current === clean && setAvailability('taken'),
        (cause) => latest.current === clean && setAvailability(cause instanceof ApiError && cause.status === 404 ? 'free' : 'idle'),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [clean, valid]);

  async function claim() {
    setSaving(true);
    setError(null);
    try {
      await api.setUsername(clean);
      finishOnboarding();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that name.');
    } finally {
      setSaving(false);
    }
  }

  const hint =
    name && !valid
      ? '3–20 letters, numbers or _, starting with a letter.'
      : availability === 'taken'
        ? 'That name is taken.'
        : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + theme.space.xxl, paddingBottom: insets.bottom + theme.space.xl }]}
    >
      <View style={{ alignItems: 'center', gap: theme.space.md }}>
        <Mascot pose="neutral" size={96} idle />
        <Text variant="title" style={styles.center}>
          Pick your name
        </Text>
        <Text variant="body" tone="secondary" style={styles.center}>
          Friends on Blocky pay you by it — no long addresses.
        </Text>
      </View>

      <View style={{ gap: theme.space.sm, marginTop: theme.space.xxl }}>
        <TextField
          label="Username"
          value={name}
          onChangeText={setName}
          placeholder="@yourname"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          error={error ?? hint}
        />
        {valid && availability === 'free' ? (
          <Text variant="caption" tone="positive">
            @{clean} is yours if you want it.
          </Text>
        ) : null}
        {valid && availability === 'checking' ? (
          <Text variant="caption" tone="tertiary">
            Checking…
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: 'auto' }}>
        <Button variant="ink" label={valid ? `Continue as @${clean}` : 'Continue'} disabled={!valid || availability === 'taken'} loading={saving} onPress={() => void claim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

/** A starting point from their email: "Sam.Lee+x@gmail.com" → "samlee". */
function suggest(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.split('+')[0]!.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const start = cleaned.replace(/^[^a-z]+/, '');
  return PATTERN.test(start.slice(0, 20)) ? start.slice(0, 20) : '';
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  center: { textAlign: 'center' },
});
