import { isDecimalString, parseUsd, type Policy } from '@blocky/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { api } from '../lib/api';
import { useTheme } from '../theme';

/**
 * Spending limits for sends the assistant proposes.
 *
 * Only the two numbers a person actually thinks about. Everything else in the
 * policy is kept exactly as it was — this screen can tighten or loosen the caps
 * and nothing more.
 */
export default function LimitsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [perSend, setPerSend] = useState('');
  const [perDay, setPerDay] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPolicy().then(
      (current) => {
        setPolicy(current);
        setPerSend(current.perTxCapUsd);
        setPerDay(current.dailyCapUsd);
      },
      (e) => setError(e instanceof Error ? e.message : 'Could not load your limits.'),
    );
  }, []);

  const problem = validate(perSend, perDay);
  const changed = policy !== null && (perSend !== policy.perTxCapUsd || perDay !== policy.dailyCapUsd);

  async function save() {
    if (!policy || problem) return;
    setSaving(true);
    setError(null);
    try {
      await api.setPolicy({ ...policy, perTxCapUsd: perSend, dailyCapUsd: perDay });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your limits.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: theme.space.xl, paddingBottom: insets.bottom + theme.space.xl, gap: theme.space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.space.sm }}>
          <Text variant="title">Spending limits</Text>
          <Text variant="body" tone="secondary">
            The most Blocky's assistant can propose. You still approve every send yourself.
          </Text>
        </View>

        <TextField
          label="Per send"
          value={perSend}
          onChangeText={(v) => setPerSend(clean(v))}
          keyboardType="decimal-pad"
          placeholder="100"
          accessory={<Text variant="body" tone="tertiary">USD</Text>}
        />
        <TextField
          label="Per day"
          value={perDay}
          onChangeText={(v) => setPerDay(clean(v))}
          keyboardType="decimal-pad"
          placeholder="250"
          accessory={<Text variant="body" tone="tertiary">USD</Text>}
          error={problem && perSend && perDay ? problem : error}
        />

        <View style={{ gap: theme.space.md }}>
          <Button label="Save" disabled={!changed || Boolean(problem)} loading={saving} onPress={save} />
          <Button label="Cancel" variant="quiet" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function clean(value: string): string {
  return value.replace(/[^0-9.]/g, '');
}

function validate(perSend: string, perDay: string): string | null {
  for (const value of [perSend, perDay]) {
    if (!isDecimalString(value) || (value.split('.')[1]?.length ?? 0) > 2) return 'Enter an amount in dollars, like 100 or 25.50.';
    if (parseUsd(value) === 0n) return 'Limits must be more than $0.';
  }
  if (parseUsd(perDay) < parseUsd(perSend)) return 'The daily limit can’t be lower than the limit per send.';
  return null;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
  },
});
