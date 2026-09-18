import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { PressableScale } from './PressableScale';

export interface PageProps {
  /** Which page of the home pager is showing: 0 is Home, 1 is Account. */
  page: number;
  onPageChange: (page: number) => void;
}

export const PAGE_COUNT = 2;
const LABELS = ['Home', 'Account'];

/**
 * Which page you're on, and a way to get to the other one without knowing you
 * can swipe. The active dot stretches into a short pill.
 */
export function PageDots({ page, onPageChange }: PageProps) {
  return (
    <View style={styles.row}>
      {LABELS.map((label, index) => (
        <PressableScale
          key={label}
          onPress={() => onPageChange(index)}
          accessibilityLabel={`Go to ${label}`}
          haptic="none"
          scaleTo={0.9}
          style={styles.hit}
        >
          <Dot active={page === index} />
        </PressableScale>
      ))}
    </View>
  );
}

function Dot({ active }: { active: boolean }) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => ({
    width: withTiming(active ? 16 : 6, { duration: 180 }),
    opacity: withTiming(active ? 1 : 0.35, { duration: 180 }),
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: theme.colors.textPrimary }, style]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // A generous touch target around a small mark.
  hit: {
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
