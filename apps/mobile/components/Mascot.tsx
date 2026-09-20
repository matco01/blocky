import { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

export type MascotPose =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'confused'
  | 'angry'
  | 'closedEyes'
  | 'lookLeft'
  | 'lookRight';

const POSES: Record<MascotPose, number> = {
  neutral: require('../assets/blocky.png'),
  happy: require('../assets/blockyhappy.png'),
  sad: require('../assets/blockysad.png'),
  confused: require('../assets/blockyconfused.png'),
  angry: require('../assets/blockyangry.png'),
  closedEyes: require('../assets/blockyclosedeyes.png'),
  lookLeft: require('../assets/blockyleftlook.png'),
  lookRight: require('../assets/blockyrightlook.png'),
};

/**
 * Poses calm enough to interrupt with a blink or a glance. `sad`/`angry`/
 * `confused` are reserved for specific moments — see "the mascot never jokes
 * about money" below — and never get randomly animated over.
 */
const IDLE_SAFE = new Set<MascotPose>(['neutral', 'happy']);

/**
 * The mascot, hand-drawn (assets/blocky*.png, background keyed out) and shown
 * plain — no plate, no clipping, no shadow.
 *
 * `sad` and `angry` exist for later, off the money path. Failed sends, danger
 * warnings and the approval screen stay calm and plain — the mascot never
 * jokes about money.
 *
 * `idle` swaps the frame for a blink or a sideways glance every few seconds,
 * entirely by picking a different pre-drawn pose — no sprite sheet, no
 * skeletal rig, just the same `<Image>` swap this component already does.
 * Only takes effect on `neutral`/`happy`; anywhere else it's a no-op.
 */
export function Mascot({
  pose = 'neutral',
  size = 120,
  idle = false,
  style,
}: {
  pose?: MascotPose;
  size?: number;
  idle?: boolean;
  style?: StyleProp<ImageStyle>;
}) {
  const [frame, setFrame] = useState<MascotPose>(pose);

  useEffect(() => {
    setFrame(pose);
    if (!idle || !IDLE_SAFE.has(pose)) return undefined;

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      // A few seconds of stillness, then either a quick blink or a longer glance.
      timer = setTimeout(() => {
        if (!alive) return;
        const glance = Math.random() < 0.3;
        setFrame(glance ? (Math.random() < 0.5 ? 'lookLeft' : 'lookRight') : 'closedEyes');

        timer = setTimeout(
          () => {
            if (!alive) return;
            setFrame(pose);
            schedule();
          },
          glance ? 1100 : 260,
        );
      }, 2400 + Math.random() * 2600);
    };
    schedule();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pose, idle]);

  return <Image source={POSES[frame]} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}
