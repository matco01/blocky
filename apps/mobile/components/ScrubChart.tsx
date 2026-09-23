import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../theme';

const HEIGHT = 140;
const PAD = 10;
const DOT = 10;

/** How long a finger rests before the chart takes the gesture — a quick swipe still pages. */
const HOLD_MS = 90;

export interface ChartPoint {
  /** Milliseconds since the epoch. */
  t: number;
  /** USD, for drawing only — never read back as money. */
  v: number;
}

/**
 * A value-over-time line you can scrub.
 *
 * Rest a finger on it and drag: a cursor follows, snapping to the recorded
 * points, and `onScrub` reports which one so the screen can show its value,
 * time and change. Lifting off hands the screen back its live number.
 *
 * Only real, recorded points are drawn and snapped to — nothing is
 * interpolated between them, so every value the cursor shows is one the wallet
 * actually held.
 */
export function ScrubChart({
  points,
  width,
  onScrub,
}: {
  points: readonly ChartPoint[];
  width: number;
  /** The index under the finger, or null when the finger lifts. */
  onScrub: (index: number | null) => void;
}) {
  const theme = useTheme();
  const active = useSharedValue(-1);

  const geometry = useMemo(() => {
    const values = points.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const plotHeight = HEIGHT - PAD * 2;
    const stepX = points.length > 1 ? width / (points.length - 1) : 0;

    const xs = points.map((_, i) => i * stepX);
    const ys = values.map((v) => (range === 0 ? PAD + plotHeight / 2 : PAD + plotHeight - ((v - min) / range) * plotHeight));

    const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ');
    const area = `${line} L ${width} ${HEIGHT} L 0 ${HEIGHT} Z`;

    return { xs, ys, stepX, line, area };
  }, [points, width]);

  const { xs, ys, stepX } = geometry;
  const last = xs.length - 1;

  const report = (index: number) => {
    onScrub(index);
    void Haptics.selectionAsync().catch(() => {});
  };
  const release = () => onScrub(null);

  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart((event) => {
      const index = Math.max(0, Math.min(last, Math.round(event.x / stepX)));
      active.value = index;
      runOnJS(report)(index);
    })
    .onUpdate((event) => {
      const index = Math.max(0, Math.min(last, Math.round(event.x / stepX)));
      if (index === active.value) return;
      active.value = index;
      runOnJS(report)(index);
    })
    .onFinalize(() => {
      if (active.value === -1) return;
      active.value = -1;
      runOnJS(release)();
    });

  const cursorStyle = useAnimatedStyle(() => {
    const index = active.value;
    return {
      opacity: withTiming(index >= 0 ? 1 : 0, { duration: 120 }),
      transform: [{ translateX: index >= 0 ? (xs[index] ?? 0) : (xs[last] ?? 0) }],
    };
  });

  const dotStyle = useAnimatedStyle(() => {
    const index = active.value >= 0 ? active.value : last;
    return { transform: [{ translateX: (xs[index] ?? 0) - DOT / 2 }, { translateY: (ys[index] ?? 0) - DOT / 2 }] };
  });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height: HEIGHT }}>
        <Svg width={width} height={HEIGHT}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.colors.accent} stopOpacity={0.18} />
              <Stop offset="1" stopColor={theme.colors.accent} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={geometry.area} fill="url(#fill)" />
          <Path
            d={geometry.line}
            stroke={theme.colors.accent}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>

        <Animated.View
          pointerEvents="none"
          style={[styles.cursor, { backgroundColor: theme.colors.borderStrong }, cursorStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.dot,
            { backgroundColor: theme.colors.accent, borderColor: theme.colors.background },
            dotStyle,
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  cursor: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  dot: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
  },
});
