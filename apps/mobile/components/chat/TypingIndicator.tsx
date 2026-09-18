import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';

/** Three softly pulsing dots while the agent works. Calmer than a spinner. */
export function TypingIndicator() {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.row} accessibilityLabel="Blocky is thinking">
      {[0, 160, 320].map((delay) => (
        <Dot key={delay} delay={delay} color={theme.colors.textTertiary} />
      ))}
    </Animated.View>
  );
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0, { duration: 420 })), -1),
    );
    return () => cancelAnimation(progress);
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateY: -2 * progress.value }],
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
