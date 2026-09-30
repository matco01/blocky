import * as Haptics from 'expo-haptics';
import { memo, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
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
 * The sign-in screen's opening: Blocky lands on his own name.
 *
 * The wordmark appears first, on its own, with a shadow growing on top of it.
 * He drops in asleep and lands on the letters — they give under him, the
 * middle ones most, in a ripple outward — with a squash and a puff of dust.
 * He wakes, looks around, and hops; the letters give again, less, when he comes
 * down. Then everything glides up into its resting place and the sign-in form
 * rises in underneath.
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

/** The wordmark he stands on. Bigger than a title: it is a platform now. */
const LETTER_SIZE = 46;
const LETTER_LINE = 52;

/**
 * How far below the top of the text's line box the tops of the tall letters
 * (B, l, k) sit. His feet land on that line, so this is what to nudge if he
 * looks like he's hovering over the letters or sinking into them.
 */
const LETTER_TOP_INSET = 9;

/** How far the wordmark tucks up under the artwork so his feet meet the letters. */
const OVERLAP = MASCOT * (1 - FEET) + LETTER_TOP_INSET;

/** Every beat, in ms from the start. */
const T = {
  word: 0, // the wordmark fades in, alone
  fall: 350, // he starts to drop
  land: 800, // ...and hits the letters
  wake: 1100, // eyes open
  lookLeft: 1300,
  lookRight: 1550,
  tagline: 1650,
  hop: 1800, // happy hop
  hopLand: 2080, // ...and back down onto the letters
  settle: 2250, // glide up; the form rises
  idle: 2650, // back to his ordinary idle blinking
} as const;

/** How long a letter takes to give under him, and to spring back. */
const PRESS_MS = 70;
const RECOVER_MS = 280;

/** Poses swapped to during the intro. Mounted once, invisibly, so the first swap never blanks for a frame while the image decodes. */
const WARM_POSES: MascotPose[] = ['neutral', 'lookLeft', 'lookRight', 'happy'];

export const IntroHero = memo(function IntroHero({ skipped, onReveal }: { skipped: boolean; onReveal: () => void }) {
  const theme = useTheme();
  const { height: screenHeight } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [stage, setStage] = useState<Stage>(reduced ? 'done' : 'waiting');
  const [pose, setPose] = useState<MascotPose>(reduced ? 'neutral' : 'closedEyes');

  const glide = useSharedValue(0);
  const fall = useSharedValue(reduced ? 0 : -screenHeight);
  const squashX = useSharedValue(1);
  const squashY = useSharedValue(1);
  const hop = useSharedValue(0);
  const shadow = useSharedValue(0);
  const word = useSharedValue(reduced ? 1 : 0);
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

  /** Where every path ends: standing on his name, blinking. */
  function rest() {
    finished.current = true;
    setStage('done');
    setPose('neutral');
  }

  /** Jump straight to the resting state — for a skip, or reduced motion. */
  function finish() {
    if (finished.current) return;
    snap();
    rest();
    revealOnce();
  }

  /**
   * Set every value to where the intro ends, without animating.
   *
   * Also the repair for an intro that was interrupted: on Android, an animation
   * started while the app is in the background can stall and never run, which
   * strands him off-screen above the letters. Setting values directly always
   * lands.
   */
  function snap() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    for (const value of [glide, fall, squashX, squashY, hop, shadow, word, tagline]) cancelAnimation(value);

    glide.value = 0;
    fall.value = 0;
    squashX.value = 1;
    squashY.value = 1;
    hop.value = 0;
    shadow.value = 0;
    word.value = 1;
    tagline.value = 1;
  }

  function play(offset: number) {
    setStage('play');

    const land = { damping: 7, stiffness: 220 };

    // Start centred on the screen; stay there until the final beat.
    glide.value = withSequence(
      withTiming(offset, { duration: 0 }),
      withDelay(T.settle, withSpring(0, { damping: 18, stiffness: 140 })),
    );
    // The platform first: something has to be there to land on.
    word.value = withDelay(T.word, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }));
    // A shadow grows on the letters as he falls toward them, then gives way to
    // the one drawn into the artwork — two shadows at once reads as a smudge.
    shadow.value = withDelay(
      T.fall - 150,
      withSequence(
        withTiming(1, { duration: T.land - T.fall + 150, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 220 }),
      ),
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
        withTiming(0, { duration: T.hopLand - T.hop - 140, easing: Easing.in(Easing.quad) }),
      ),
    );
    tagline.value = withDelay(T.tagline, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));

    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    at(T.land, () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}));
    at(T.wake, () => setPose('neutral'));
    at(T.lookLeft, () => setPose('lookLeft'));
    at(T.lookRight, () => setPose('lookRight'));
    at(T.hop, () => setPose('happy'));
    at(T.hopLand, () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}));
    at(T.settle, revealOnce);
    at(T.idle, rest);
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

  // Leaving the app mid-intro ends it: the rest would otherwise play (or stall)
  // unseen. Coming back re-applies the end state, in case it didn't take while
  // the app was in the background.
  useEffect(() => {
    let wasAway = false;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        wasAway = true;
        finish();
      } else if (wasAway) {
        wasAway = false;
        snap();
      }
    });
    return () => subscription.remove();
  }, []);

  const heroStyle = useAnimatedStyle(() => ({ transform: [{ translateY: glide.value }] }));
  const mascotStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: fall.value + hop.value }, { scaleX: squashX.value }, { scaleY: squashY.value }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: shadow.value * 0.16,
    transform: [{ scaleX: 0.3 + 0.7 * shadow.value }],
  }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value,
    transform: [{ translateY: (1 - tagline.value) * 10 }],
  }));

  return (
    <Animated.View onLayout={onLayout} style={[styles.hero, heroStyle]}>
      <View style={styles.stage}>
        <Animated.View style={[styles.shadow, shadowStyle]} />
        {[-1, 1].flatMap((dir) =>
          [0, 1, 2].map((i) => (
            <Puff key={`${dir}${i}`} dir={dir} index={i} stage={stage} color={theme.colors.borderStrong} />
          )),
        )}
        <Animated.View style={[styles.mascot, mascotStyle]}>
          <Mascot pose={pose} size={MASCOT} idle={stage === 'done'} />
        </Animated.View>

        {stage === 'play' ? (
          <View style={[StyleSheet.absoluteFill, styles.warm]} pointerEvents="none">
            {WARM_POSES.map((warm) => (
              <Mascot key={warm} pose={warm} size={MASCOT} style={StyleSheet.absoluteFill} />
            ))}
          </View>
        ) : null}
      </View>

      <Animated.View
        style={[styles.word, wordStyle]}
        accessible
        accessibilityRole="header"
        accessibilityLabel={WORD}
      >
        {WORD.split('').map((char, index) => (
          <PlatformLetter key={index} char={char} index={index} stage={stage} />
        ))}
      </Animated.View>

      <Animated.View style={[{ marginTop: theme.space.md }, taglineStyle]}>
        <Text variant="body" tone="secondary" style={styles.center}>
          Your money, and an assistant that moves it for you.
        </Text>
      </Animated.View>
    </Animated.View>
  );
});

/**
 * One letter of the wordmark, giving under his weight.
 *
 * The middle letters take the landing and dip furthest; the push travels
 * outward, a beat later and weaker at each step, so the word reads as one
 * springy plank rather than six separate bounces. His hop lands again at half
 * the force.
 */
function PlatformLetter({ char, index, stage }: { char: string; index: number; stage: Stage }) {
  const press = useSharedValue(0);

  // Distance from the middle of the word, in letters: 0.5 for the two centre
  // ones, 2.5 for the ends.
  const distance = Math.abs(index - (WORD.length - 1) / 2);
  const weight = 1 - ((distance - 0.5) / (WORD.length / 2)) * 0.8;
  const ripple = (distance - 0.5) * 35;

  useEffect(() => {
    if (stage === 'play') {
      const give = (force: number) =>
        withSequence(
          withTiming(force, { duration: PRESS_MS, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: RECOVER_MS, easing: Easing.out(Easing.back(3)) }),
        );

      press.value = withDelay(
        T.land + ripple,
        withSequence(give(weight), withDelay(T.hopLand - T.land - PRESS_MS - RECOVER_MS, give(weight * 0.5))),
      );
    } else if (stage === 'done') {
      cancelAnimation(press);
      press.value = 0;
    }
  }, [stage, weight, ripple, press]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: press.value * 7 },
      { scaleX: 1 + press.value * 0.07 },
      { scaleY: 1 - press.value * 0.14 },
    ],
  }));

  return (
    <Animated.View style={[styles.letterBox, style]}>
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
    // Drawn over the letters: his feet overlap the top of the wordmark.
    zIndex: 1,
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
    // Not zero: a fully transparent view can be skipped by the renderer, and
    // then nothing is decoded ahead of time.
    opacity: 0.01,
  },
  word: {
    flexDirection: 'row',
    marginTop: -OVERLAP,
  },
  letterBox: {
    // Letters squash down onto their baseline, not toward their middle.
    transformOrigin: ['50%', '100%', 0],
  },
  letter: {
    fontSize: LETTER_SIZE,
    lineHeight: LETTER_LINE,
  },
  center: {
    textAlign: 'center',
  },
});
