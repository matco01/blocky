import { StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import type { Capability } from '../../lib/capabilities';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

/** A row of tappable boxes — the compact alternative to spelling every option out in prose. */
export function CapabilityChips({ capabilities, onPick }: { capabilities: Capability[]; onPick: (c: Capability) => void }) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(220)} style={[styles.row, { gap: theme.space.sm }]}>
      {capabilities.map((capability) => (
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
