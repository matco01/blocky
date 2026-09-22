import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { Mascot, type MascotPose } from './Mascot';
import { Text } from './Text';

/**
 * The sign-in screen's opening: Blocky arrives.
 *
 * A shadow grows on an empty screen; he drops in asleep, lands with a squash
 * and a puff of dust, wakes, looks around, and hops. The letters of his name
 * drop in after him like small blocks landing. Then everything glides up into
 * its resting place and the sign-in form rises in underneath.
 *
 * It lives on the sign-in screen because that screen is only reachable signed
 * out — so this plays for someone new, or someone coming back, and never
 * stands between a signed-in user and their money.
 *
 * Built only from poses the artwork already has. Every beat uses the same
 * timeline table below, so the rhythm can be read (and retimed) in one place.
 * Tapping anywhere skips to the end; with the system's reduce-motion setting
 * on, it never plays at all.
 */

type Stage = 'waiting' | 'play' | 'done';

const WORD = 'Blocky';
const MASCOT = 140;

/**
 * Where the ground is inside the artwork, as a fraction of its height. The
 * PNG is square with space above the sprout, so "the bottom of the image" is
 * not where his feet are. The squash pivots here, and the shadow and dust sit
 * here — otherwise he'd appear to land in mid-air or sink into the floor.
 */
const FEET = 0.83;

/** Every beat, in ms from the start. */
const T = {
  fall: 150, // he starts to drop
  land: 600, // ...and hits the ground
  wake: 900, // eyes open
  lookLeft: 1100,
  lookRight: 1350,
  letters: 1000, // first letter drops
  letterGap: 70,
  tagline: 1450,
  hop: 1600, // happy hop
  settle: 2000, // glide up; the form rises
  idle: 2400, // back to his ordinary idle blinking
} as const;

/** Poses swapped to during the intro. Mounted once, invisibly, so the first swap never blanks for a frame while the image decodes. */
const WARM_POSES: MascotPose[] = ['neutral', 'lookLeft', 'lookRight', 'happy'];

export function IntroHero({ skipped, onReveal }: { skipped: boolean; onReveal: () => void }) {
  const theme = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [stage, setStage] = useState<Stage>(reduced ? 'done' : 'waiting');
  const [pose, setPose] = useState<MascotPose>(reduced ? 'neutral' : 'closedEyes');
  const [idle, setIdle] = useState(reduced);

  const glide = useSharedValue(0);
  const fall = useSharedValue(reduced ? 0 : -screenHeight);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const hop = useSharedValue(0);
  const shadow = useSharedValue(0);
  const tagline = useSharedValue(reduced ? 1 : 0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const started = useRef(false);
  const finished = useRef(reduced);
  const revealed = useRef(false);

  // The latest callback, without re-running anything when the parent re-renders.
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  function revealOnce() {
    if (revealed.current) return;
    revealed.current = true;
    onRevealRef.current();
  }

  /** Jump straight to the resting state — for a skip, or reduced motion. */
  function finish() {
    if (finished.current) return;
    finished.current = true;

    timers.current.forEach(clearTimeout);
    timers.current = [];
    for (const value of [glide, fall, squashX, squashY, hop, shadow, tagline]) cancelAnimation(value);

    glide.value = 0;
    fall.value = 0;
    squashX.value = 1;
    squashY.value = 1;
    hop.value = 0;
    shadow.value = 0;
    tagline.value = 1;

    setStage('done');
    setPose('neutral');
    setIdle(true);
    revealOnce();
  }

  function play(offset: number) {
    setStage('play');

    const land = { damping: 7, stiffness: 220 };

    // Start centred on the screen; stay there until the final beat.
    glide.value = withSequence(
      withTiming(offset, { duration: 0 }),
      withDelay(T.settle, withSpring(0, { damping: 18, stiffness: 140 })),
    );
    // A shadow grows as he falls toward it, then gives way to the one drawn
    // into the artwork — two shadows at once reads as a smudge.
    shadow.value = withSequence(
      withTiming(1, { duration: T.land, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 220 }),
    );
    fall.value = withDelay(
      T.fall,
      withTiming(0, { duration: T.land - T.fall, easing: Easing.in(Easing.quad) }),
    );
    // Squash on impact, then let the spring's own overshoot do the stretch.
    squashX.value = withDelay(T.land, withSequence(withTiming(1.22, { duration: 70 }), withSpring(1, land)));
    squashY.value = withDelay(T.land, withSequence(withTiming(0.78, { duration: 70 }), withSpring(1, land)));
    hop.value = withDelay(
      T.hop,
      withSequence(
        withTiming(-18, { duration: 140, easing: Easing.out(Easing.quad) }),
        withSpring(0, { damping: 9, stiffness: 260 }),
      ),
    );
    tagline.value = withDelay(T.tagline, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));

    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    at(T.land, () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}));
    at(T.wake, () => setPose('neutral'));
    at(T.lookLeft, () => setPose('lookLeft'));
    at(T.lookRight, () => setPose('lookRight'));
    at(T.hop, () => setPose('happy'));
    at(T.hop + 280, () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}));
    at(T.settle, revealOnce);
    at(T.idle, () => {
      finished.current = true;
      setStage('done');
      setPose('neutral');
      setIdle(true);
    });
  }

  function onLayout(event: LayoutChangeEvent) {
    // Only the first layout counts: later ones (the keyboard opening, say)
    // must not re-centre a hero that has already settled.
    if (started.current || finished.current) return;
    started.current = true;

    const { y, height } = event.nativeEvent.layout;
    play(screenHeight / 2 - (y + height / 2));
  }

  // Mount-only: reduced motion is read once, like the initial values above.
  useEffect(() => {
    if (reduced) revealOnce();
    return () => timers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (skipped) finish();
  }, [skipped]);

  const heroStyle = useAnimatedStyle(() => ({ transform: [{ translateY: glide.value }] }));
  const mascotStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: fall.value + hop.value }, { scaleX: squashX.value }, { scaleY: squashY.value }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: shadow.value * 0.16,
    transform: [{ scaleX: 0.3 + 0.7 * shadow.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value,
    transform: [{ translateY: (1 - tagline.value) * 10 }],
  }));

  return (
    <Animated.View onLayout={onLayout} style={[styles.hero, { gap: theme.space.lg }, heroStyle]}>
      <View style={styles.stage}>
        <Animated.View style={[styles.shadow, shadowStyle]} />
        {[-1, 1].flatMap((dir) =>
          [0, 1, 2].map((i) => (
            <Puff key={`${dir}${i}`} dir={dir} index={i} stage={stage} color={theme.colors.borderStrong} />
          )),
        )}
        <Animated.View style={[styles.mascot, mascotStyle]}>
          <Mascot pose={pose} size={MASCOT} idle={idle} />
        </Animated.View>

        {stage === 'play' ? (
          <View style={styles.warm} pointerEvents="none">
            {WARM_POSES.map((warm) => (
              <Mascot key={warm} pose={warm} size={MASCOT} style={StyleSheet.absoluteFill} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ alignItems: 'center', gap: theme.space.sm }}>
        <View style={styles.word} accessible accessibilityRole="header" accessibilityLabel={WORD}>
          {WORD.split('').map((char, index) => (
            <DropLetter key={index} char={char} index={index} stage={stage} />
          ))}
        </View>
        <Animated.View style={taglineStyle}>
          <Text variant="body" tone="secondary" style={styles.center}>
            Your money, and an assistant that moves it for you.
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** One letter of the wordmark, dropping in like a block and settling with a wobble. */
function DropLetter({ char, index, stage }: { char: string; index: number; stage: Stage }) {
  const progress = useSharedValue(stage === 'done' ? 1 : 0);
  // Alternate the lean so the letters don't all tip the same way.
  const tilt = index % 2 === 0 ? -14 : 12;

  useEffect(() => {
    if (stage === 'play') {
      progress.value = withDelay(T.letters + index * T.letterGap, withSpring(1, { damping: 9, stiffness: 240 }));
    } else if (stage === 'done') {
      cancelAnimation(progress);
      progress.value = 1;
    }
  }, [stage, index, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 4),
    transform: [{ translateY: (1 - progress.value) * -40 }, { rotate: `${(1 - progress.value) * tilt}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <Text variant="title" tone="brand" style={styles.letter}>
        {char}
      </Text>
    </Animated.View>
  );
}

/** A puff of dust kicked out sideways when he lands. */
function Puff({ dir, index, stage, color }: { dir: number; index: number; stage: Stage; color: string }) {
  const progress = useSharedValue(stage === 'done' ? 1 : 0);
  const size = 12 - index * 2;
  const dx = dir * (18 + index * 16);
  const dy = -(4 + index * 5);

  useEffect(() => {
    if (stage === 'play') {
      progress.value = withDelay(T.land, withTiming(1, { duration: 480, easing: Easing.out(Easing.quad) }));
    } else if (stage === 'done') {
      cancelAnimation(progress);
      progress.value = 1;
    }
  }, [stage, progress]);

  const style = useAnimatedStyle(() => ({
    // Invisible until the landing starts it, and gone again by the end.
    opacity: progress.value === 0 ? 0 : (1 - progress.value) * 0.9,
    transform: [
      { translateX: dx * progress.value },
      { translateY: dy * progress.value },
      { scale: 0.4 + 0.8 * progress.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.puff,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          left: MASCOT / 2 + dir * 20 - size / 2,
          top: MASCOT * FEET - size / 2,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
  },
  stage: {
    width: MASCOT,
    height: MASCOT,
  },
  mascot: {
    // Pivot the squash at his feet, not the middle of the image.
    transformOrigin: ['50%', `${FEET * 100}%`, 0],
  },
  shadow: {
    position: 'absolute',
    left: MASCOT * 0.19,
    width: MASCOT * 0.62,
    top: MASCOT * FEET - 6,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000',
  },
  puff: {
    position: 'absolute',
  },
  warm: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Not zero: a fully transparent view can be skipped by the renderer, and
    // then nothing is decoded ahead of time.
    opacity: 0.01,
  },
  word: {
    flexDirection: 'row',
  },
  letter: {
    fontSize: 34,
    lineHeight: 40,
  },
  center: {
    textAlign: 'center',
  },
});
