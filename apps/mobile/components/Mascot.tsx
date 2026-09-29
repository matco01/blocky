import { useEffect, useState } from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';

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
 * In-betweens for a glance, from the turnaround sheet: the neutral pose's eyes
 * sliding to his right. Cleaned and aligned to the neutral pose's body, so
 * stepping through them moves only the face. A glance left is the same frames
 * mirrored.
 */
const TURN = [
  require('../assets/blockyturn1.png'),
  require('../assets/blockyturn2.png'),
  require('../assets/blockyturn3.png'),
] as const;

/** What's on screen: a pose, or a step of the turn (optionally mirrored). */
type Frame = { pose: MascotPose } | { turn: 0 | 1 | 2; mirrored: boolean };

const STEP_MS = 90;
const HOLD_MS = 1800;
const BLINK_MS = 260;

/**
 * The mascot, hand-drawn (assets/blocky*.png, background keyed out) and shown
 * plain — no plate, no clipping, no shadow.
 *
 * `sad` and `angry` exist for later, off the money path. Failed sends, danger
 * warnings and the approval screen stay calm and plain — the mascot never
 * jokes about money.
 *
 * `idle` adds a blink or a glance every few seconds. Every frame is mounted
 * up front and only its opacity changes: swapping an `<Image>`'s source makes
 * Android decode the new picture on the spot, which is what made the old
 * one-picture glance look like a flicker. Glances only run on `neutral` — the
 * turn frames are drawn from that face.
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
  style?: StyleProp<ViewStyle>;
}) {
  const [frame, setFrame] = useState<Frame>({ pose });
  const animated = idle && (pose === 'neutral' || pose === 'happy');

  useEffect(() => {
    setFrame({ pose });
    if (!animated) return undefined;

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const later = (ms: number, fn: () => void) => {
      timer = setTimeout(() => alive && fn(), ms);
    };

    const glance = (mirrored: boolean) => {
      const steps: Frame[] = [0, 1, 2].map((turn) => ({ turn: turn as 0 | 1 | 2, mirrored }));
      const back: Frame[] = [steps[1]!, steps[0]!, { pose }];
      const run = (queue: Frame[], then: () => void) => {
        const [next, ...rest] = queue;
        if (!next) return then();
        setFrame(next);
        later(STEP_MS, () => run(rest, then));
      };
      run(steps, () => later(HOLD_MS, () => run(back, schedule)));
    };

    const schedule = () =>
      later(2400 + Math.random() * 2600, () => {
        if (pose === 'neutral' && Math.random() < 0.3) {
          glance(Math.random() < 0.5);
        } else {
          setFrame({ pose: 'closedEyes' });
          later(BLINK_MS, () => {
            setFrame({ pose });
            schedule();
          });
        }
      });
    schedule();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pose, animated]);

  const box = [{ width: size, height: size }, style];
  // An explicit size on every layer: Android's image view doesn't reliably size
  // an absolutely-positioned image from its insets alone.
  const layer = { position: 'absolute' as const, top: 0, left: 0, width: size, height: size };

  if (!animated) {
    return (
      <View style={box}>
        <Image source={POSES[pose]} style={layer} resizeMode="contain" />
      </View>
    );
  }

  const shown = (candidate: Frame) =>
    'pose' in frame && 'pose' in candidate
      ? frame.pose === candidate.pose
      : 'turn' in frame && 'turn' in candidate && frame.turn === candidate.turn;
  const mirrored = 'turn' in frame && frame.mirrored;

  return (
    <View style={box}>
      {([pose, 'closedEyes'] as const).map((p) => (
        <Image
          key={p}
          source={POSES[p]}
          style={[layer, { opacity: shown({ pose: p }) ? 1 : 0 }]}
          resizeMode="contain"
        />
      ))}
      {TURN.map((source, i) => (
        <Image
          key={`turn${i}`}
          source={source}
          style={[
            layer,
            { opacity: shown({ turn: i as 0 | 1 | 2, mirrored }) ? 1 : 0 },
            mirrored ? { transform: [{ scaleX: -1 }] } : null,
          ]}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}
