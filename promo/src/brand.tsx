import { loadFont } from '@remotion/google-fonts/Figtree';
import type { CSSProperties, ReactNode } from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

/** Blocky's own palette, from the app's theme tokens. */
export const C = {
  paper: '#FFFCF8',
  stone100: '#F6F0E9',
  stone200: '#E6DDD3',
  ink: '#2B1F1A',
  ink600: '#6E6058',
  maroon: '#723431',
  maroonDeep: '#4A1F1D',
  maroonTint: '#F6E6E4',
  leaf: '#367526',
  leafBright: '#7DBE5A',
  leafTint: '#E6F2DF',
  white: '#FFFFFF',
};

export const { fontFamily } = loadFont('normal', { weights: ['500', '600', '700', '800'] });

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);

/** A springy 0 → 1 that starts at `delay` frames. */
export function usePop(delay = 0, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120, mass: 0.9, ...config } });
}

/** Fade + rise, for text coming in. */
export function useRise(delay = 0, distance = 40) {
  const p = usePop(delay, { damping: 18 });
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` } as CSSProperties;
}

/** Fade the whole scene out over its last few frames. */
export function useSceneOut(length: number, over = 8) {
  const frame = useCurrentFrame();
  return interpolate(frame, [length - over, length], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

export type Pose = 'blocky' | 'blockyhappy' | 'blockyclosedeyes' | 'blockyleftlook' | 'blockyrightlook';

export function Mascot({ pose = 'blocky', size, style }: { pose?: Pose; size: number; style?: CSSProperties }) {
  return <Img src={staticFile(`${pose}.png`)} style={{ width: size, height: size, objectFit: 'contain', ...style }} />;
}

export function Wordmark({ size = 150, color = C.maroon }: { size?: number; color?: string }) {
  return (
    <div style={{ fontFamily, fontWeight: 800, fontSize: size, color, letterSpacing: -size * 0.04, lineHeight: 1 }}>Blocky</div>
  );
}

export function Screen({ children, background = C.paper }: { children: ReactNode; background?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background,
        fontFamily,
        color: C.ink,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

/** A chat bubble, the user's (right, maroon tint) or Blocky's (left, plain). */
export function Bubble({ from, children, style }: { from: 'user' | 'blocky'; children: ReactNode; style?: CSSProperties }) {
  const user = from === 'user';
  return (
    <div
      style={{
        alignSelf: user ? 'flex-end' : 'flex-start',
        background: user ? C.maroonTint : 'transparent',
        color: C.ink,
        fontSize: 46,
        fontWeight: 600,
        lineHeight: 1.3,
        padding: user ? '26px 38px' : '8px 4px',
        borderRadius: 44,
        maxWidth: 800,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The confirmation card the app shows for a plan. */
export function PlanCard({
  verb,
  amount,
  line,
  detail,
  status,
  statusTone = 'muted',
  style,
}: {
  verb: string;
  amount: string;
  line: string;
  detail?: string;
  status?: string;
  statusTone?: 'muted' | 'good';
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: 860,
        background: C.white,
        borderRadius: 48,
        border: `4px solid ${C.stone200}`,
        boxShadow: '0 30px 80px rgba(43,31,26,0.10)',
        padding: '44px 52px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 34, fontWeight: 600, color: C.ink600 }}>
        <span>{verb}</span>
        {status ? <span style={{ color: statusTone === 'good' ? C.leaf : C.ink600 }}>{status}</span> : null}
      </div>
      <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: -3, lineHeight: 1.1 }}>{amount}</div>
      <div style={{ fontSize: 40, fontWeight: 600, color: C.ink600 }}>{line}</div>
      {detail ? <div style={{ fontSize: 32, fontWeight: 500, color: C.ink600, opacity: 0.8 }}>{detail}</div> : null}
    </div>
  );
}

/** Type a string out over `frames`, starting at `delay`. */
export function useTyped(text: string, delay: number, frames: number) {
  const frame = useCurrentFrame();
  const n = Math.round(interpolate(frame, [delay, delay + frames], [0, text.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return text.slice(0, n);
}
