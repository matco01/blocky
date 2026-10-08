import { displayUsd, parseUsd } from '@blocky/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { PressableScale } from '../components/PressableScale';
import { ScreenHeader } from '../components/ScreenHeader';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { Tile } from '../components/Tile';
import { api, type Pot } from '../lib/api';
import { useModalTopPadding } from '../lib/screenInsets';
import { useTheme } from '../theme';

/**
 * Savings pots: money set aside for something — a trip, a car, a rainy day.
 * The money never leaves the wallet; a pot is a promise the app keeps for
 * them, and a send that would break it warns first.
 */
export default function PotsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topPadding = useModalTopPadding();
  const [pots, setPots] = useState<Pot[] | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchPots = useCallback(async () => {
    setPots(await api.pots().catch(() => []));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchPots();
    }, [fetchPots]),
  );

  async function create() {
    if (!name.trim()) return;
    setError(null);
    try {
      await api.createPot(name.trim(), goal.trim().replace('$', '') || null);
      setName('');
      setGoal('');
      await fetchPots();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create that pot.');
    }
  }

  async function adjust(pot: Pot, sign: 1 | -1) {
    const value = amount.trim().replace('$', '');
    if (!/^\d+(\.\d{1,6})?$/.test(value)) return;
    setError(null);
    try {
      await api.adjustPot(pot.id, sign === 1 ? value : `-${value}`);
      setAmount('');
      await fetchPots();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not move that.');
    }
  }

  function remove(pot: Pot) {
    Alert.alert(`Delete ${pot.name}?`, 'The money stays in your wallet — it just stops being set aside.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void api.deletePot(pot.id).then(fetchPots, () => {}),
      },
    ]);
  }

  const saved = (pots ?? []).reduce((sum, pot) => sum + parseUsd(pot.savedUsd), 0n);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <ScreenHeader title="Pots" feature="maroon" subtitle="Money set aside for the things you want." onClose={() => router.back()} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.space.xl, gap: theme.space.lg }]}
      >
        <Text variant="body" tone="secondary">
          {pots && pots.length > 0
            ? `${displayUsd(saved)} set aside. It stays in your wallet; sends warn you before using it.`
            : 'Set money aside for something. It stays in your wallet; sends warn you before using it.'}
        </Text>

        {(pots ?? []).map((pot) => {
          const pct = pot.targetUsd && parseUsd(pot.targetUsd) > 0n ? Math.min(100, Number((parseUsd(pot.savedUsd) * 100n) / parseUsd(pot.targetUsd))) : null;
          return (
            <Tile key={pot.id} style={{ padding: theme.space.lg, gap: theme.space.sm }}>
              <PressableScale onPress={() => setOpen(open === pot.id ? null : pot.id)} accessibilityLabel={pot.name} style={styles.row}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {pot.name}
                </Text>
                <Text variant="bodyStrong">{displayUsd(pot.savedUsd)}</Text>
              </PressableScale>
              {pct !== null ? (
                <>
                  <View style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <View style={[styles.fill, { width: `${pct}%`, backgroundColor: theme.colors.accent }]} />
                  </View>
                  <Text variant="caption" tone="tertiary">
                    {pct}% of {displayUsd(pot.targetUsd!)}
                  </Text>
                </>
              ) : null}
              {open === pot.id ? (
                <View style={{ gap: theme.space.sm }}>
                  <TextField label="Amount, in dollars" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="50" />
                  <View style={[styles.row, { gap: theme.space.sm }]}>
                    <View style={{ flex: 1 }}>
                      <Button label="Add" size="compact" onPress={() => void adjust(pot, 1)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Take out" size="compact" variant="quiet" onPress={() => void adjust(pot, -1)} />
                    </View>
                  </View>
                  <Button label="Delete pot" size="compact" variant="quiet" onPress={() => remove(pot)} />
                </View>
              ) : null}
            </Tile>
          );
        })}

        {error ? (
          <Text variant="body" tone="warning">
            {error}
          </Text>
        ) : null}

        <Tile style={{ padding: theme.space.lg, gap: theme.space.sm }}>
          <Text variant="label" tone="secondary">
            New pot
          </Text>
          <TextField label="What for" value={name} onChangeText={setName} placeholder="Trip to Lisbon" />
          <TextField label="Goal (optional)" value={goal} onChangeText={setGoal} keyboardType="decimal-pad" placeholder="500" />
          <Button label="Create pot" size="compact" disabled={!name.trim()} onPress={() => void create()} />
        </Tile>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 24 },
  content: { paddingHorizontal: 24, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
