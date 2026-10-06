import type { CSSProperties, ReactNode } from 'react';
import { interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, fontFamily } from './brand';

/** A hit of camera shake from `at`, dying out over `frames`. */
export function useShake(at: number, strength = 26, frames = 14): CSSProperties {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > frames) return {};
  const decay = 1 - t / frames;
  const x = (random(`sx${at}-${t}`) - 0.5) * 2 * strength * decay;
  const y = (random(`sy${at}-${t}`) - 0.5) * 2 * strength * decay;
  const r = (random(`sr${at}-${t}`) - 0.5) * 3 * decay;
  return { transform: `translate(${x}px, ${y}px) rotate(${r}deg)` };
}

/** Text that slams in: huge, then snaps to size, with a blur-less overshoot. */
export function Slam({
  children,
  at = 0,
  size = 180,
  color = C.ink,
  style,
}: {
  children: ReactNode;
  at?: number;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 260, mass: 0.7 } });
  const scale = interpolate(p, [0, 1], [3.2, 1]);
  return (
    <div
      style={{
        fontFamily,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: -size * 0.04,
        lineHeight: 1,
        color,
        opacity: frame < at ? 0 : Math.min(1, p * 3),
        transform: `scale(${scale})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const CONFETTI_COLORS = [C.leafBright, C.maroon, '#E8A94A', '#CC7B76', C.leaf, '#F2826F'];

/** A confetti burst from a point, with gravity. Deterministic, so every render matches. */
export function Confetti({ at, x = 540, y = 900, count = 70, spread = 1 }: { at: number; x?: number; y?: number; count?: number; spread?: number }) {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > 90) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const angle = random(`a${at}-${i}`) * Math.PI * 2;
        const speed = (14 + random(`s${at}-${i}`) * 26) * spread;
        const px = x + Math.cos(angle) * speed * t;
        const py = y + Math.sin(angle) * speed * t + 0.9 * t * t;
        const spin = random(`r${at}-${i}`) * 720 * (t / 30);
        const w = 14 + random(`w${at}-${i}`) * 18;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px,
              top: py,
              width: w,
              height: w * 0.55,
              borderRadius: 3,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              transform: `rotate(${spin}deg)`,
              opacity: interpolate(t, [60, 90], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}
          />
        );
      })}
    </div>
  );
}

/** Rings punching out from a point — for impacts. */
export function Burst({ at, x = 540, y = 960, color = C.leafBright, rings = 3 }: { at: number; x?: number; y?: number; color?: string; rings?: number }) {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({ length: rings }, (_, i) => {
        const t = frame - at - i * 4;
        if (t < 0 || t > 24) return null;
        const r = interpolate(t, [0, 24], [40, 620 + i * 120]);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - r,
              top: y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: '50%',
              border: `${interpolate(t, [0, 24], [22, 2])}px solid ${color}`,
              opacity: interpolate(t, [0, 24], [0.9, 0]),
            }}
          />
        );
      })}
    </>
  );
}

/** Speed lines streaking across, for fast moments. */
export function SpeedLines({ color = 'rgba(255,255,255,0.35)', count = 18, direction = 1 }: { color?: string; count?: number; direction?: 1 | -1 }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const y = random(`ly${i}`) * 1920;
        const len = 200 + random(`ll${i}`) * 500;
        const speed = 60 + random(`lv${i}`) * 80;
        const x = (((random(`lx${i}`) * 2200 + frame * speed) % 2600) - 400) * direction + (direction < 0 ? 1080 : 0);
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: len, height: 6, borderRadius: 3, background: color }} />;
      })}
    </div>
  );
}

/** A number counting up, formatted as dollars. */
export function useCount(to: number, at: number, frames: number) {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [at, at + frames], [0, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  return v;
}

export function dollars(v: number, cents = false): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}
