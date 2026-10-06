import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, Mascot, fontFamily, type Pose } from '../brand';

/** 120 BPM at 30fps: a beat every 15 frames. Everything cuts on these. */
export const BEAT = 15;

export function useSpringAt(at: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 170, mass: 0.8, ...config } });
}

/** The inspo's signature move: arrive blurred and snap into focus. */
export function BlurIn({
  at,
  children,
  from = 36,
  rise = 30,
  frames = 10,
  style,
}: {
  at: number;
  children: ReactNode;
  from?: number;
  rise?: number;
  frames?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => 1 - Math.pow(1 - t, 3) });
  return (
    <div style={{ opacity: p, filter: `blur(${(1 - p) * from}px)`, transform: `translateY(${(1 - p) * rise}px) scale(${0.94 + p * 0.06})`, ...style }}>
      {children}
    </div>
  );
}

/** And the way out: blur away over the last frames of a scene. */
export function useBlurOut(length: number, frames = 7) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [length - frames, length], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return { opacity: 1 - p, filter: `blur(${p * 30}px)`, transform: `scale(${1 + p * 0.06})` } as CSSProperties;
}

/** White, with a soft brand glow in a corner — the inspo's pink, in Blocky's green and maroon. */
export function Glow({ corner = 'br', color = C.leafBright, second = C.maroonTint }: { corner?: 'br' | 'bl' | 'tr'; color?: string; second?: string }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 40) * 60;
  const pos = corner === 'br' ? { right: -260 + drift, bottom: -300 } : corner === 'bl' ? { left: -260 - drift, bottom: -300 } : { right: -260, top: -300 + drift };
  return (
    <AbsoluteFill style={{ background: '#FFFEFC', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 900, height: 900, borderRadius: '50%', background: `radial-gradient(circle, ${color}55, transparent 65%)`, ...pos }} />
      <div
        style={{
          position: 'absolute',
          width: 700,
          height: 700,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${second}, transparent 65%)`,
          left: corner === 'br' ? 520 - drift : 40,
          bottom: -380,
        }}
      />
    </AbsoluteFill>
  );
}

/** Blocky, Duolingo-style: squash and stretch, a hop, the odd blink. */
export function LiveBlocky({
  pose = 'blocky',
  size,
  hopAt,
  blinkAt = [],
  style,
}: {
  pose?: Pose;
  size: number;
  hopAt?: number;
  blinkAt?: number[];
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const breathe = 1 + Math.sin(frame / 7) * 0.025;
  // Always called, so the hook order never changes when a hop is added mid-scene.
  const hop = useSpringAt(hopAt ?? 1e9, { damping: 6, stiffness: 180 });
  const hopping = hopAt !== undefined && frame >= hopAt && frame < hopAt + 24;
  const lift = hopping ? Math.sin(Math.min(1, (frame - hopAt!) / 14) * Math.PI) * size * 0.35 : 0;
  const squash = hopping ? 1 + (1 - hop) * 0.25 : breathe;
  const blinking = blinkAt.some((at) => frame >= at && frame < at + 4);
  return (
    <div style={{ transform: `translateY(${-lift}px) scaleY(${squash}) scaleX(${2 - squash})`, transformOrigin: 'bottom center', ...style }}>
      <Mascot pose={blinking ? 'blockyclosedeyes' : pose} size={size} />
    </div>
  );
}

/** A speech bubble Blocky says things in — a sticker, white outline and all. */
export function SpeechBubble({ children, at, style }: { children: ReactNode; at: number; style?: CSSProperties }) {
  const p = useSpringAt(at, { damping: 9, stiffness: 220 });
  return (
    <div
      style={{
        fontFamily,
        fontWeight: 800,
        fontSize: 44,
        color: C.white,
        background: C.leaf,
        padding: '14px 30px',
        borderRadius: 34,
        border: `6px solid ${C.white}`,
        boxShadow: '0 12px 30px rgba(43,31,26,0.18)',
        transform: `scale(${p}) rotate(${(1 - p) * -12 - 4}deg)`,
        transformOrigin: 'bottom left',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A mouse cursor, moving between points and pressing. */
export function Cursor({ path, pressAt = [] }: { path: Array<{ at: number; x: number; y: number }>; pressAt?: number[] }) {
  const frame = useCurrentFrame();
  const ats = path.map((p) => p.at);
  const x = interpolate(frame, ats, path.map((p) => p.x), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => t * t * (3 - 2 * t) });
  const y = interpolate(frame, ats, path.map((p) => p.y), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => t * t * (3 - 2 * t) });
  const pressing = pressAt.some((at) => frame >= at && frame < at + 5);
  const visible = frame >= path[0]!.at - 2;
  if (!visible) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${pressing ? 0.8 : 1})`, transformOrigin: 'top left', zIndex: 50 }}>
      <svg width={56} height={70} viewBox="0 0 28 35">
        <path d="M2 2 L2 27 L9 20 L14 32 L19 30 L14 18 L24 18 Z" fill="#111" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Sound, placed on the frame it belongs to. */
export function Sfx({ at, name, volume = 1 }: { at: number; name: 'pop' | 'whoosh' | 'tap' | 'type' | 'coin' | 'success' | 'boing'; volume?: number }) {
  return (
    <Sequence from={at} durationInFrames={30} layout="none">
      {/* Headroom: effects land on top of the music, so never at full scale. */}
      <Audio src={staticFile(`audio/sfx-${name}.wav`)} volume={volume * 0.62} />
    </Sequence>
  );
}

export const text = (size: number, weight = 800, color = C.ink): CSSProperties => ({
  fontFamily,
  fontSize: size,
  fontWeight: weight,
  color,
  letterSpacing: -size * 0.035,
  lineHeight: 1.05,
});
