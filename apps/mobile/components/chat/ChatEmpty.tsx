import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

export interface Capability {
  title: string;
  /**
   * What tapping does: `send` asks the text straight away; `prefill` puts it
   * in the input instead, for requests that need the user's own details.
   */
  action: { kind: 'send'; text: string } | { kind: 'prefill'; text: string };
}

/** Three things to try before typing anything. Blocky's greeting sits above, in his bubble. */
export const CAPABILITIES: Capability[] = [
  { title: 'What can you do?', action: { kind: 'send', text: 'What can you do?' } },
  { title: "What's live on Arc?", action: { kind: 'send', text: "What's live on Arc right now?" } },
  { title: 'Send $', action: { kind: 'prefill', text: 'Send $' } },
];

export function ChatEmpty({ onPick }: { onPick: (capability: Capability) => void }) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(300)} style={[styles.row, { gap: theme.space.sm }]}>
      {CAPABILITIES.map((capability) => (
        <PressableScale
          key={capability.title}
          onPress={() => onPick(capability)}
          accessibilityLabel={capability.title}
          style={[
            styles.chip,
            {
              backgroundColor: theme.colors.surfaceMuted,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.space.md,
              paddingVertical: theme.space.sm + 2,
            },
          ]}
        >
          <Text variant="label">{capability.title}</Text>
        </PressableScale>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {},
});
