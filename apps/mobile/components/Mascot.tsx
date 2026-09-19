import { Image, type ImageStyle, type StyleProp } from 'react-native';

export type MascotPose = 'neutral' | 'happy' | 'sad' | 'confused' | 'angry';

const POSES: Record<MascotPose, number> = {
  neutral: require('../assets/blocky.png'),
  happy: require('../assets/blockyhappy.png'),
  sad: require('../assets/blockysad.png'),
  confused: require('../assets/blockyconfused.png'),
  angry: require('../assets/blockyangry.png'),
};

/**
 * The mascot, hand-drawn (assets/blocky*.png, background keyed out) and shown
 * plain — no plate, no clipping, no shadow.
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
  style?: StyleProp<ImageStyle>;
}) {
  return <Image source={POSES[pose]} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}
