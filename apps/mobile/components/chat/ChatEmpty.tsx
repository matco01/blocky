import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

export interface Capability {
  title: string;
  /**
   * What tapping does: `send` asks the text straight away; `prefill` puts it
   * in the input instead, for requests that need the user's own details —
   * nobody wants a suggestion that sends $20 to a Sam they don't have.
   */
  action: { kind: 'send'; text: string } | { kind: 'prefill'; text: string };
}

/**
 * The one thing offered before the user has typed anything. Everything else
 * Blocky can do, it explains itself when asked — see the agent's own
 * "what Blocky can do today" list in the system prompt, which this defers to
 * rather than duplicating.
 */
export const CAPABILITIES: Capability[] = [
  { title: 'What can you do?', action: { kind: 'send', text: 'What can you do?' } },
];

export function ChatEmpty({ onPick }: { onPick: (capability: Capability) => void }) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(300)} style={[styles.container, { gap: theme.space.md }]}>
      <Text variant="heading">What do you want to do?</Text>

      <View style={{ gap: theme.space.sm }}>
        {CAPABILITIES.map((capability) => (
          <PressableScale
            key={capability.title}
            onPress={() => onPick(capability)}
            accessibilityLabel={capability.title}
            style={[
              styles.row,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.space.lg,
                paddingVertical: theme.space.md,
              },
            ]}
          >
            <Text variant="bodyStrong" style={styles.rowText}>
              {capability.title}
            </Text>
            <Text variant="heading" tone="tertiary">
              ›
            </Text>
          </PressableScale>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
  },
});
