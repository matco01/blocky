import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Mascot, type MascotPose } from '../Mascot';
import { Text } from '../Text';
import { Tile } from '../Tile';
import { ThinkingDots } from './TypingIndicator';

export type StageState = 'empty' | 'busy' | 'conversation' | 'docked';

const SIZE: Record<StageState, number> = { empty: 96, busy: 96, conversation: 64, docked: 44 };
const POSE: Record<StageState, MascotPose> = { empty: 'happy', busy: 'neutral', conversation: 'neutral', docked: 'neutral' };

/**
 * Blocky and, when there is nothing else to read, his speech bubble.
 *
 * He never scrolls: this sits above the chat list. The bubble only appears in
 * the empty state and while he's thinking — it is never a second place where
 * replies show up. Once the conversation is under way he shrinks; once you
 * scroll or type he docks smaller still. Poses stay calm on money paths.
 */
export function MascotStage({ state, busySize }: { state: StageState; busySize?: number }) {
  const theme = useTheme();
  const size = state === 'busy' && busySize ? busySize : SIZE[state];
  const bubble = state === 'empty' || state === 'busy';

  return (
    <Animated.View layout={LinearTransition.duration(180)} style={[styles.row, { gap: theme.space.md }]}>
      <Mascot pose={POSE[state]} size={size} />

      {bubble ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.bubbleWrap}>
          {/* The tail: a rotated square in the stroke colour, with the surface colour on top. */}
          <View style={[styles.tail, { backgroundColor: theme.colors.border }]} />
          <View style={[styles.tail, styles.tailInner, { backgroundColor: theme.colors.surface }]} />
          <Tile style={{ paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md }}>
            {state === 'busy' ? (
              <View style={styles.thinking}>
                <Text variant="bodyStrong" tone="secondary">
                  Thinking
                </Text>
                <ThinkingDots />
              </View>
            ) : (
              <Text variant="bodyStrong">Hi! What do you want to do?</Text>
            )}
          </Tile>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bubbleWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  tail: {
    position: 'absolute',
    left: -5,
    width: 14,
    height: 14,
    transform: [{ rotate: '45deg' }],
    zIndex: 1,
  },
  tailInner: {
    left: -2,
    zIndex: 2,
  },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
