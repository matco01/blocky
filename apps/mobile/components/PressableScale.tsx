import * as Haptics from 'expo-haptics';
import { useCallback, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { motion } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TIMING: WithTimingConfig = { duration: motion.fast };

export interface PressableScaleProps {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /**
   * How far it compresses. The default is subtle on purpose — a button that
   * visibly shrinks reads as a toy, and this app is holding someone's money.
   */
  scaleTo?: number;
  /**
   * Haptic fired on press-in. `heavy` is reserved for irreversible actions:
   * signing, confirming, sending. Overusing it makes it meaningless exactly
   * where it matters most.
   */
  haptic?: 'light' | 'medium' | 'heavy' | 'none';
  accessibilityLabel?: string;
}

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

export function PressableScale({
  onPress,
  children,
  style,
  disabled = false,
  scaleTo = 0.97,
  haptic = 'light',
  accessibilityLabel,
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(scaleTo, TIMING);

    if (haptic !== 'none') {
      // Fire and forget: a failed haptic must never block a tap.
      void Haptics.impactAsync(IMPACT[haptic]).catch(() => {});
    }
  }, [haptic, scale, scaleTo]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, TIMING);
  }, [scale]);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle, disabled && { opacity: 0.4 }]}
    >
      {children}
    </AnimatedPressable>
  );
}
