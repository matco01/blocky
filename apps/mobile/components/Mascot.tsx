import { useEffect, useRef, useState } from 'react';
import { Animated, Image, View, type StyleProp, type ViewStyle } from 'react-native';

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
 * Crossfades. The glance frames are drawn rounder than the standing pose, so a
 * hard swap between the two reads as a snap; easing into and out of the turn
 * hides it. Steps within the turn fade quicker. Blinks stay a hard cut — a
 * blink that fades looks like a flicker.
 */
const TURN_IN_OUT_MS = 160;
const TURN_STEP_MS = 70;

/** Layers bottom to top: the pose, its blink, then the three turn frames. */
const LAYER_COUNT = 5;
function layerOf(frame: Frame): number {
  if ('turn' in frame) return 2 + frame.turn;
  return frame.pose === 'closedEyes' ? 1 : 0;
}

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
        // Stepping off the standing pose crossfades for longer than a step:
        // wait it out, or the next frame starts over a half-faded one.
        const fromPose = queue === steps;
        later(fromPose ? TURN_IN_OUT_MS : STEP_MS, () => run(rest, then));
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

  // One opacity per layer, and which layer is showing now.
  const opacities = useRef(Array.from({ length: LAYER_COUNT }, (_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const showing = useRef(0);
  // The direction of the last glance, kept while it fades out: the frame
  // state is already back on the pose by then, and the fading frame must not
  // flip mid-fade.
  const lastMirrored = useRef(false);
  if ('turn' in frame) lastMirrored.current = frame.mirrored;
  const mirrored = lastMirrored.current;

  useEffect(() => {
    const prev = showing.current;
    const next = layerOf(frame);
    if (next === prev) return;
    showing.current = next;

    if (prev <= 1 && next <= 1) {
      // A blink: a hard cut.
      opacities[prev]!.setValue(0);
      opacities[next]!.setValue(1);
      return;
    }

    const duration = prev <= 1 || next <= 1 ? TURN_IN_OUT_MS : TURN_STEP_MS;
    if (next > prev) {
      // The new frame is on top: fade it in over the old, then drop the old.
      opacities[next]!.setValue(0);
      Animated.timing(opacities[next]!, { toValue: 1, duration, useNativeDriver: true }).start(({ finished }) => {
        if (finished && showing.current !== prev) opacities[prev]!.setValue(0);
      });
    } else {
      // The new frame is underneath: show it, and fade the old one off it.
      opacities[next]!.setValue(1);
      Animated.timing(opacities[prev]!, { toValue: 0, duration, useNativeDriver: true }).start();
    }
  }, [frame, opacities]);

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

  return (
    <View style={box}>
      {([pose, 'closedEyes'] as const).map((p, i) => (
        <Animated.Image key={p} source={POSES[p]} style={[layer, { opacity: opacities[i] }]} resizeMode="contain" />
      ))}
      {TURN.map((source, i) => (
        <Animated.Image
          key={`turn${i}`}
          source={source}
          style={[layer, { opacity: opacities[2 + i] }, mirrored ? { transform: [{ scaleX: -1 }] } : null]}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}

