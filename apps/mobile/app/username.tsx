import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { api } from '../lib/api';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

/** Pick the name friends pay you by — "@sam" — instead of a 0x address. */
export default function UsernameScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const [name, setName] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((me) => {
      setCurrent(me.username ?? null);
      setName(me.username ?? '');
    }, () => {});
  }, []);

  const clean = name.trim().replace(/^@/, '').toLowerCase();
  const valid = /^[a-z][a-z0-9_]{2,19}$/.test(clean);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setUsername(clean);
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that name.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: topPadding, paddingBottom: insets.bottom + theme.space.xl }]}>
      <ScreenHeader title="Your name" onClose={() => router.back()} />

      <View style={{ gap: theme.space.md, marginTop: theme.space.xl }}>
        <Text variant="body" tone="secondary">
          Friends on Blocky can pay you by this name instead of your address.
        </Text>
        <TextField
          label="Username"
          value={name}
          onChangeText={setName}
          placeholder="@sam"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          error={error ?? (name && !valid ? '3–20 letters, numbers or _, starting with a letter.' : null)}
        />
        {valid ? (
          <Text variant="caption" tone="tertiary">
            People will send to @{clean}.
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: 'auto', gap: theme.space.md }}>
        <Button label={current ? 'Change name' : 'Claim name'} disabled={!valid || clean === current} loading={saving} onPress={() => void save()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
});
