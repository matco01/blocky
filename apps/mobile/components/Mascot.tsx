import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { palette } from '../theme';

export type MascotPose = 'neutral' | 'happy' | 'sad' | 'confused' | 'angry';

const POSES: Record<MascotPose, number> = {
  neutral: require('../assets/blocky.jpg'),
  happy: require('../assets/blockyhappy.jpg'),
  sad: require('../assets/blockysad.jpg'),
  confused: require('../assets/blockyconfused.jpg'),
  angry: require('../assets/blockyangry.jpg'),
};

/**
 * The mascot, hand-drawn (assets/blocky*.jpg) and shown on a small cream
 * "sticker" plate.
 *
 * The source art sits on a plain white square. Rather than keying that
 * background out — which would need image editing this app doesn't have —
 * every pose sits on the same cream plate, in both colour schemes. That reads
 * as an intentional sticker rather than a mistake, and means the mascot never
 * surprises us with a stray white box on a dark screen.
 *
 * `sad` and `angry` exist for later, off the money path — see "the mascot
 * never jokes about money" in the README's design-direction section. Only
 * `neutral` and `happy` are used today, on the two lowest-risk screens:
 * login and the empty chat state.
 */
export function Mascot({
  pose = 'neutral',
  size = 120,
  style,
}: {
  pose?: MascotPose;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    // The shadow lives on an outer, unclipped view — clipping the inner one
    // (below) to crop the artwork's square background would clip the shadow too.
    <View
      style={[
        styles.shadow,
        { width: size, height: size, borderRadius: size / 2, boxShadow: '0px 6px 16px rgba(43, 33, 27, 0.18)' },
        style,
      ]}
    >
      <View style={[styles.plate, { borderRadius: size / 2, backgroundColor: palette.cream50 }]}>
        <Image source={POSES[pose]} style={{ width: size * 0.86, height: size * 0.86 }} resizeMode="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {},
  plate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
