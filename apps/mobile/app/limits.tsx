import { isDecimalString, parseUsd, type Policy } from '@blocky/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { Tile } from '../components/Tile';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { api } from '../lib/api';
import { useTheme } from '../theme';

/**
 * Spending limits for sends the assistant proposes, and how much ceremony
 * stands in front of approving one.
 *
 * The numbers a person actually thinks about, and nothing else: the rest of the
 * policy is written back untouched.
 *
 * One-tap sending is the only switch here, and it is deliberately modest. It
 * does not let the assistant send anything by itself — it has no key and cannot
 * sign. It decides whether a proposal inside the caps opens the full review
 * screen or goes straight to the fingerprint. Off by default, because the caps
 * only mean something once you have watched what the assistant proposes.
 */
export default function LimitsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [perSend, setPerSend] = useState('');
  const [perDay, setPerDay] = useState('');
  const [oneTap, setOneTap] = useState(false);
  const [threshold, setThreshold] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPolicy().then(
      (current) => {
        setPolicy(current);
        setPerSend(current.perTxCapUsd);
        setPerDay(current.dailyCapUsd);
        setOneTap(current.enabled);
        setThreshold(current.autoExecuteThresholdUsd);
      },
      (e) => setError(e instanceof Error ? e.message : 'Could not load your limits.'),
    );
  }, []);

  const problem = validate(perSend, perDay, oneTap ? threshold : null);
  const changed =
    policy !== null &&
    (perSend !== policy.perTxCapUsd ||
      perDay !== policy.dailyCapUsd ||
      oneTap !== policy.enabled ||
      (oneTap && threshold !== policy.autoExecuteThresholdUsd));

  async function save() {
    if (!policy || problem) return;
    setSaving(true);
    setError(null);
    try {
      await api.setPolicy({
        ...policy,
        perTxCapUsd: perSend,
        dailyCapUsd: perDay,
        enabled: oneTap,
        // Left as it was when one-tap is off, so turning it back on restores
        // the number the user last chose rather than a default.
        autoExecuteThresholdUsd: oneTap ? threshold : policy.autoExecuteThresholdUsd,
      });
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
          <ScreenHeader title="Spending limits" onClose={() => router.back()} />
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

        <Tile style={{ padding: theme.space.lg, gap: theme.space.md }}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">One-tap sending</Text>
              <Text variant="caption" tone="secondary">
                Skip the review screen for small sends to people you have already
                sent to. You still approve with your fingerprint.
              </Text>
            </View>
            <Switch
              value={oneTap}
              onValueChange={setOneTap}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor={theme.colors.background}
              accessibilityLabel="One-tap sending"
            />
          </View>

          {oneTap ? (
            <TextField
              label="Skip review under"
              value={threshold}
              onChangeText={(v) => setThreshold(clean(v))}
              keyboardType="decimal-pad"
              placeholder="25"
              accessory={<Text variant="body" tone="tertiary">USD</Text>}
            />
          ) : null}
        </Tile>

        <View style={{ gap: theme.space.md }}>
          <Button label="Save" disabled={!changed || Boolean(problem)} loading={saving} onPress={save} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function clean(value: string): string {
  return value.replace(/[^0-9.]/g, '');
}

function validate(perSend: string, perDay: string, threshold: string | null): string | null {
  for (const value of [perSend, perDay, ...(threshold === null ? [] : [threshold])]) {
    if (!isDecimalString(value) || (value.split('.')[1]?.length ?? 0) > 2) return 'Enter an amount in dollars, like 100 or 25.50.';
    if (parseUsd(value) === 0n) return 'Limits must be more than $0.';
  }
  if (parseUsd(perDay) < parseUsd(perSend)) return 'The daily limit can’t be lower than the limit per send.';

  /*
   * A threshold above the per-send cap would never be reached: the cap denies
   * the plan outright before one-tap could ever apply to it.
   */
  if (threshold !== null && parseUsd(threshold) > parseUsd(perSend)) {
    return 'The one-tap amount can’t be higher than the limit per send.';
  }
  return null;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
});
