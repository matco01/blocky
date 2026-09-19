import * as Haptics from 'expo-haptics';
import { useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { EDGE, useTheme } from '../theme';

export interface BlockPressableProps {
  onPress?: () => void;
  children: ReactNode;
  /** Face colour. */
  fill: string;
  /** The darker edge underneath. */
  edge: string;
  /** Stroke around the face, for secondary blocks. */
  stroke?: string;
  height: number;
  radius?: number;
  disabled?: boolean;
  /** `heavy` is for irreversible actions only: signing, sending. */
  haptic?: 'light' | 'medium' | 'heavy' | 'none';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

/**
 * A block: a rounded square that sits on a darker edge and presses down onto it.
 *
 * Only the face's transform animates — never a border width — so the press
 * runs on the UI thread and nothing reflows. The occupied height is constant
 * (face + edge) in every state, including disabled, so a button that flips
 * enabled as the user types never shifts the layout under their thumb.
 */
export function BlockPressable({
  onPress,
  children,
  fill,
  edge,
  stroke,
  height,
  radius,
  disabled = false,
  haptic = 'light',
  accessibilityLabel,
  style,
}: BlockPressableProps) {
  const theme = useTheme();
  const r = radius ?? theme.radius.lg;
  const travel = useSharedValue(0);

  const face = useAnimatedStyle(() => ({ transform: [{ translateY: travel.value }] }));

  const pressIn = useCallback(() => {
    travel.value = withTiming(EDGE, { duration: 90 });
    if (haptic !== 'none') void Haptics.impactAsync(IMPACT[haptic]).catch(() => {});
  }, [haptic, travel]);

  const pressOut = useCallback(() => {
    travel.value = withTiming(0, { duration: 120 });
  }, [travel]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[{ height: height + EDGE, borderRadius: r, backgroundColor: edge }, disabled && styles.disabled, style]}
    >
      <Animated.View
        style={[
          styles.face,
          {
            height,
            borderRadius: r,
            backgroundColor: fill,
            borderWidth: stroke ? theme.stroke : 0,
            borderColor: stroke,
          },
          face,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
});
