import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Sfx } from './kit';
import {
  CHAT_CUES,
  COINS_AT,
  Cluster,
  DROP_AT,
  FRIEND_CUES,
  Friends,
  HIT_AT,
  Icons,
  Intro,
  Logo,
  PhoneDemo,
  Pot,
  Promise,
  S1,
  S2,
  S3,
  S4,
  S5,
  S6,
  S7,
  S8,
} from './scenes';

/**
 * v3: the inspo's clean, blurry-cut Apple polish, with Blocky's Duolingo-ish
 * bounce — square, 25 seconds, every cut on the 120 BPM grid of the track,
 * and every sound effect on the frame of the thing it belongs to.
 */
const SCENES = [
  { Scene: Intro, frames: S1 },
  { Scene: Promise, frames: S2 },
  { Scene: PhoneDemo, frames: S3 },
  { Scene: Cluster, frames: S4 },
  { Scene: Friends, frames: S5 },
  { Scene: Pot, frames: S6 },
  { Scene: Icons, frames: S7 },
  { Scene: Logo, frames: S8 },
];

const starts = SCENES.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + SCENES[i - 1]!.frames], []);
export const V3_FRAMES = SCENES.reduce((sum, s) => sum + s.frames, 0);

/** Every sound effect, at the absolute frame it happens. */
function soundtrack() {
  const [s1, s2, s3, s4, s5, s6, s7, s8] = starts as [number, number, number, number, number, number, number, number];
  const cues: Array<{ at: number; name: Parameters<typeof Sfx>[0]['name']; volume?: number }> = [
    { at: s1 + 6, name: 'whoosh', volume: 0.6 },
    { at: s1 + 21, name: 'boing', volume: 0.9 },
    { at: s1 + 23, name: 'pop', volume: 0.6 },
    ...[0, 6, 15, 22].map((f) => ({ at: s2 + f, name: 'pop' as const, volume: 0.5 })),
    { at: s2 + 32, name: 'boing', volume: 0.6 },
    { at: s2 + 40, name: 'pop', volume: 0.7 },
    { at: s3 + 2, name: 'whoosh', volume: 0.7 },
    ...Array.from({ length: 12 }, (_, k) => ({ at: s3 + CHAT_CUES.typeFrom + k * 2, name: 'type' as const, volume: 0.5 })),
    { at: s3 + CHAT_CUES.sendAt, name: 'pop', volume: 0.8 },
    { at: s3 + CHAT_CUES.thinkEnd, name: 'pop', volume: 0.5 },
    { at: s3 + CHAT_CUES.cardAt, name: 'whoosh', volume: 0.5 },
    { at: s3 + CHAT_CUES.tapAt, name: 'tap', volume: 1 },
    { at: s3 + CHAT_CUES.sentAt, name: 'success', volume: 0.9 },
    { at: s3 + CHAT_CUES.sentAt + 2, name: 'boing', volume: 0.5 },
    { at: s3 + 152, name: 'whoosh', volume: 0.7 },
    ...[8, 13, 18, 23, 28, 33].map((f) => ({ at: s4 + f, name: 'pop' as const, volume: 0.55 })),
    { at: s5, name: 'whoosh', volume: 0.5 },
    { at: s5 + FRIEND_CUES.tapAt, name: 'tap', volume: 1 },
    { at: s5 + FRIEND_CUES.paidAt, name: 'coin', volume: 0.9 },
    ...COINS_AT.map((f) => ({ at: s6 + f + 13, name: 'coin' as const, volume: 0.6 })),
    { at: s6 + COINS_AT[COINS_AT.length - 1]! + 16, name: 'boing', volume: 0.8 },
    ...[0, 3, 6, 9, 12, 15].map((f) => ({ at: s7 + f, name: 'pop' as const, volume: 0.4 })),
    { at: s7 + DROP_AT, name: 'whoosh', volume: 0.8 },
    { at: s7 + DROP_AT, name: 'boing', volume: 0.7 },
    { at: s8, name: 'whoosh', volume: 0.5 },
    { at: s8 + HIT_AT, name: 'success', volume: 0.7 },
  ];
  return cues.map((cue, i) => <Sfx key={i} at={cue.at} name={cue.name} volume={cue.volume ?? 1} />);
}

export function PromoV3() {
  return (
    <AbsoluteFill style={{ background: '#FFFEFC' }}>
      <Audio src={staticFile('audio/music.wav')} volume={0.48} />
      {soundtrack()}
      {SCENES.map(({ Scene, frames }, i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={frames}>
          <Scene />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
