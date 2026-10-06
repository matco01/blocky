import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Bubble, C, Mascot, PlanCard, Wordmark, fontFamily, useTyped, type Pose } from './brand';
import { Burst, Confetti, Slam, SpeedLines, dollars, useCount, useShake } from './fx';

const fill = (background: string) => ({ background, fontFamily, color: C.ink, overflow: 'hidden' as const });
const center = { alignItems: 'center', justifyContent: 'center' } as const;

function useSpring(at: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 180, mass: 0.8, ...config } });
}

/* -------------------------------------------------------------------------- */
/*  A — "Just ask."                                                            */
/* -------------------------------------------------------------------------- */

export const ASK = 40;
export function Ask() {
  const shake = useShake(14, 30);
  return (
    <AbsoluteFill style={{ ...fill(C.maroon), ...center }}>
      <SpeedLines />
      <Burst at={14} y={1000} />
      <div style={{ ...shake, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <Slam at={2} size={220} color={C.paper}>
          Just
        </Slam>
        <Slam at={14} size={260} color={C.leafBright}>
          ask.
        </Slam>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  B — Blocky crashes onto his name                                           */
/* -------------------------------------------------------------------------- */

export const DROP = 60;
export function Drop() {
  const frame = useCurrentFrame();
  const fall = useSpring(0, { damping: 8, stiffness: 140, mass: 1 });
  const y = interpolate(fall, [0, 1], [-1500, 0]);
  const squash = interpolate(frame, [12, 16, 24], [1, 0.72, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shake = useShake(14, 34, 16);

  return (
    <AbsoluteFill style={{ ...fill(C.paper), ...center }}>
      <Burst at={14} y={1010} color={C.maroon} />
      <Confetti at={14} y={1000} count={50} />
      <div style={{ ...shake, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ transform: `translateY(${y}px) scaleY(${squash}) scaleX(${2 - squash})`, transformOrigin: 'bottom center', marginBottom: -40 }}>
          <Mascot pose={frame > 18 ? 'blockyhappy' : 'blocky'} size={460} />
        </div>
        <Slam at={14} size={210} color={C.maroon}>
          Blocky
        </Slam>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  C — Send. Buy. Swap. (fast)                                                */
/* -------------------------------------------------------------------------- */

const BEATS: Array<{ text: string; bg: string; fg: string; pose: Pose }> = [
  { text: 'Send money.', bg: C.leaf, fg: C.white, pose: 'blockyhappy' },
  { text: 'Buy stocks.', bg: C.paper, fg: C.maroon, pose: 'blockyleftlook' },
  { text: 'Swap anything.', bg: C.maroonDeep, fg: C.leafBright, pose: 'blockyrightlook' },
];
export const KINETIC = 75;
export function Kinetic() {
  const frame = useCurrentFrame();
  const beat = Math.min(2, Math.floor(frame / 25));
  const at = beat * 25;
  const b = BEATS[beat]!;
  const shake = useShake(at + 3, 22, 10);
  const peek = useSpring(at + 6, { damping: 10 });

  return (
    <AbsoluteFill style={{ ...fill(b.bg), ...center }}>
      <SpeedLines color={beat === 1 ? 'rgba(114,52,49,0.12)' : 'rgba(255,255,255,0.18)'} direction={beat % 2 ? -1 : 1} />
      <div style={shake}>
        <Slam key={beat} at={at} size={150} color={b.fg} style={{ textAlign: 'center' }}>
          {b.text}
        </Slam>
      </div>
      <div style={{ position: 'absolute', bottom: -60, transform: `translateY(${(1 - peek) * 420}px) rotate(${beat === 1 ? -8 : 8}deg)` }}>
        <Mascot pose={b.pose} size={380} />
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  D — The chat: typed, planned, approved, SENT                               */
/* -------------------------------------------------------------------------- */

export const CHAT = 150;
export function ChatV2() {
  const frame = useCurrentFrame();
  const message = 'Send @sam $20 for lunch 🍜'.replace(' 🍜', '');
  const typed = useTyped(message, 4, 20);
  const sentAt = 26;
  const bubble = useSpring(sentAt, { damping: 11 });
  const thinking = frame > sentAt + 3 && frame < sentAt + 24;
  const card = useSpring(sentAt + 26, { damping: 11, stiffness: 150 });
  const touchAt = 86;
  const touch = useSpring(touchAt, { damping: 9 });
  const doneAt = 102;
  const done = frame >= doneAt;
  const check = useSpring(doneAt, { damping: 8, stiffness: 220 });
  const jump = useSpring(doneAt, { damping: 7, stiffness: 160 });
  const punch = interpolate(frame, [doneAt, doneAt + 6, doneAt + 18], [1, 1.07, 1.02], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const push = interpolate(frame, [0, CHAT], [1, 1.08]);
  const shake = useShake(doneAt, 18, 12);

  return (
    <AbsoluteFill style={{ ...fill(C.stone100), ...center }}>
      <div style={{ ...shake, transform: `${shake.transform ?? ''} scale(${push * punch})`, width: 940, display: 'flex', flexDirection: 'column', gap: 30 }}>
        {frame < sentAt ? (
          <div style={{ background: C.white, border: `5px solid ${C.stone200}`, borderRadius: 60, padding: '34px 44px', fontSize: 52, fontWeight: 700 }}>
            {typed}
            <span style={{ color: C.leaf, opacity: Math.floor(frame / 4) % 2 }}>|</span>
          </div>
        ) : (
          <>
            <Bubble from="user" style={{ fontSize: 52, transform: `scale(${bubble})`, transformOrigin: 'right center' }}>
              {message}
            </Bubble>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, height: 190 }}>
              <div style={{ transform: done ? `translateY(${-jump * 60 + 60}px)` : thinking ? `rotate(${Math.sin(frame / 2) * 7}deg)` : undefined }}>
                <Mascot pose={thinking ? 'blockyclosedeyes' : 'blockyhappy'} size={190} />
              </div>
              <div style={{ fontSize: 48, fontWeight: 700, color: thinking ? C.ink600 : C.ink }}>
                {thinking ? `thinking${'.'.repeat(1 + (Math.floor(frame / 4) % 3))}` : done ? 'Done. Lunch is paid.' : 'Here it is — tap to approve.'}
              </div>
            </div>
            <div style={{ transform: `translateY(${(1 - card) * 500}px) rotate(${(1 - card) * 10}deg)`, alignSelf: 'center' }}>
              <PlanCard verb="Send" amount="$20.00" line="to @sam" detail="Instant · No Blocky fee" status={done ? '✓ Sent' : 'Needs approval'} statusTone={done ? 'good' : 'muted'} />
            </div>
            <div style={{ height: 200, display: 'flex', ...center, position: 'relative' }}>
              {frame >= touchAt - 6 && !done ? (
                <div style={{ transform: `scale(${0.7 + touch * 0.3})`, width: 170, height: 170, borderRadius: 85, border: `10px solid ${C.maroon}`, display: 'flex', ...center }}>
                  <div style={{ width: 80, height: 100, borderRadius: 40, border: `9px solid ${C.maroon}`, borderBottomColor: 'transparent' }} />
                  <div style={{ position: 'absolute', inset: -60 * touch, borderRadius: 999, border: `8px solid ${C.leafBright}`, opacity: 1 - touch }} />
                </div>
              ) : null}
              {done ? (
                <div style={{ width: 190, height: 190, borderRadius: 95, background: C.leaf, color: C.white, fontSize: 120, fontWeight: 800, display: 'flex', ...center, transform: `scale(${check}) rotate(${(1 - check) * -90}deg)` }}>
                  ✓
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
      <Burst at={doneAt} y={1420} />
      <Confetti at={doneAt} y={1400} count={90} spread={1.2} />
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  E — Stocks: a live chart draws itself                                      */
/* -------------------------------------------------------------------------- */

export const STOCK = 60;
export function Stock() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [8, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const price = useCount(342.18, 8, 36);
  const pill = useSpring(40, { damping: 8 });
  const points = Array.from({ length: 24 }, (_, i) => {
    const x = 40 + i * 36;
    const y = 360 - i * 11 - Math.sin(i * 1.3) * 30 - random(`c${i}`) * 26;
    return [x, y] as const;
  });
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const length = 1400;
  const last = points[Math.min(points.length - 1, Math.floor(draw * (points.length - 1)))]!;

  return (
    <AbsoluteFill style={{ ...fill(C.white), ...center, gap: 40 }}>
      <Slam at={0} size={96} color={C.maroon}>
        “Buy $50 of Apple”
      </Slam>
      <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -5 }}>{dollars(price, true)}</div>
      <svg width={920} height={420} style={{ overflow: 'visible' }}>
        <path d={d} fill="none" stroke={C.leaf} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={length} strokeDashoffset={length * (1 - draw)} />
        <circle cx={last[0]} cy={last[1]} r={22} fill={C.leafBright} />
        <circle cx={last[0]} cy={last[1]} r={22 + (frame % 20) * 2} fill="none" stroke={C.leafBright} strokeWidth={4} opacity={1 - (frame % 20) / 20} />
      </svg>
      <div style={{ transform: `scale(${pill})`, background: C.leafTint, color: C.leaf, fontSize: 56, fontWeight: 800, padding: '16px 40px', borderRadius: 60 }}>▲ +2.4% · 0.147 AAPL</div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  F — Swap: USDC flies across and lands as ETH                               */
/* -------------------------------------------------------------------------- */

export const SWAP = 55;
export function Swap() {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [6, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => x * x * (3 - 2 * x) });
  const x = interpolate(t, [0, 1], [-300, 300]);
  const y = -Math.sin(t * Math.PI) * 360;
  const spin = t * 720;
  const landed = frame > 32;
  const shake = useShake(33, 20, 10);
  const label = useSpring(36);

  return (
    <AbsoluteFill style={{ ...fill(C.leafTint), ...center }}>
      <SpeedLines color="rgba(54,117,38,0.18)" />
      <Burst at={33} x={840} y={960} color={C.leaf} />
      <div style={{ ...shake, position: 'relative', width: 1080, height: 700 }}>
        <div
          style={{
            position: 'absolute',
            left: 540 + x - 150,
            top: 350 + y - 150,
            width: 300,
            height: 300,
            borderRadius: 150,
            background: landed ? '#627EEA' : '#2775CA',
            color: C.white,
            fontSize: 76,
            fontWeight: 800,
            display: 'flex',
            ...center,
            transform: `rotateY(${spin}deg) scale(${landed ? 1.1 : 1})`,
            boxShadow: '0 30px 60px rgba(0,0,0,0.18)',
          }}
        >
          {t < 0.5 ? 'USDC' : 'ETH'}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 380, textAlign: 'center', transform: `scale(${label})` }}>
        <div style={{ fontSize: 84, fontWeight: 800, color: C.leaf }}>USDC → ETH on Base</div>
        <div style={{ fontSize: 46, fontWeight: 700, color: C.ink600 }}>cheapest route · 2 seconds</div>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  G — Memecoins: paste a contract, get the coin                              */
/* -------------------------------------------------------------------------- */

export const MEME = 55;
export function Meme() {
  const frame = useCurrentFrame();
  const paste = useSpring(2, { damping: 10 });
  const coin = useSpring(18, { damping: 8, stiffness: 140 });
  const check1 = useSpring(30, { damping: 9 });
  const check2 = useSpring(38, { damping: 9 });
  const shake = useShake(18, 24, 10);

  return (
    <AbsoluteFill style={{ ...fill(C.maroonDeep), ...center, gap: 50 }}>
      <SpeedLines color="rgba(125,190,90,0.15)" direction={-1} />
      <div style={{ transform: `translateX(${(1 - paste) * -900}px)`, background: C.paper, color: C.maroon, borderRadius: 60, padding: '30px 50px', fontSize: 58, fontWeight: 800, fontFamily: 'monospace' }}>
        0x4ed4…efefed
      </div>
      <div style={{ ...shake }}>
        <div
          style={{
            width: 330,
            height: 330,
            borderRadius: 165,
            background: `radial-gradient(circle at 35% 30%, #B79CFF, #7C4DDB)`,
            color: C.white,
            fontSize: 84,
            fontWeight: 800,
            display: 'flex',
            ...center,
            transform: `scale(${coin}) rotateY(${(1 - coin) * 540 + Math.sin(frame / 5) * 12}deg)`,
            boxShadow: '0 0 90px rgba(183,156,255,0.6)',
          }}
        >
          DEGEN
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center' }}>
        <div style={{ transform: `scale(${check1})`, background: C.leafTint, color: C.leaf, fontSize: 44, fontWeight: 800, padding: '12px 32px', borderRadius: 40 }}>✓ found on Base</div>
        <div style={{ transform: `scale(${check2})`, background: C.leafTint, color: C.leaf, fontSize: 44, fontWeight: 800, padding: '12px 32px', borderRadius: 40 }}>✓ sells back fine</div>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  H — Pots: coins drop into the jar                                          */
/* -------------------------------------------------------------------------- */

export const POT = 60;
export function Pot() {
  const frame = useCurrentFrame();
  const saved = useCount(200, 6, 44);
  const level = saved / 500;
  const title = useSpring(0);

  return (
    <AbsoluteFill style={{ ...fill(C.paper), ...center, gap: 40 }}>
      <div style={{ transform: `scale(${title})`, textAlign: 'center' }}>
        <div style={{ fontSize: 44, fontWeight: 700, color: C.ink600 }}>Savings pot</div>
        <div style={{ fontSize: 96, fontWeight: 800, color: C.maroon, letterSpacing: -3 }}>Trip to Lisbon</div>
      </div>
      <div style={{ position: 'relative', width: 480, height: 620 }}>
        {/* coins falling in */}
        {Array.from({ length: 7 }, (_, i) => {
          const at = 4 + i * 6;
          const t = frame - at;
          if (t < 0 || t > 18) return null;
          const yy = interpolate(t, [0, 18], [-700, 520 - level * 420], { easing: (x) => x * x });
          return (
            <div key={i} style={{ position: 'absolute', left: 150 + ((i * 53) % 150), top: yy, width: 110, height: 110, borderRadius: 55, background: '#E8A94A', border: '8px solid #9A5A0C', color: '#9A5A0C', fontSize: 58, fontWeight: 800, display: 'flex', ...center }}>
              $
            </div>
          );
        })}
        {/* the jar */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '70px 70px 90px 90px', border: `14px solid ${C.maroon}`, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${level * 100}%`, background: `linear-gradient(${C.leafBright}, ${C.leaf})` }} />
        </div>
      </div>
      <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: -4 }}>
        {dollars(saved)} <span style={{ color: C.ink600, fontSize: 64 }}>of $500</span>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  I — Insights: the month, spun up                                           */
/* -------------------------------------------------------------------------- */

export const INSIGHTS = 55;
export function InsightsV2() {
  const frame = useCurrentFrame();
  const spent = useCount(1240, 4, 34);
  const sweep = interpolate(frame, [4, 38], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => 1 - Math.pow(1 - x, 3) });
  const bar = interpolate(frame, [26, 48], [0, 0.8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const r = 250;
  const circ = 2 * Math.PI * r;
  const segments = [
    { share: 0.55, color: C.maroon },
    { share: 0.35, color: C.leaf },
    { share: 0.1, color: '#E8A94A' },
  ];
  let offset = 0;

  return (
    <AbsoluteFill style={{ ...fill(C.paper), ...center, gap: 50 }}>
      <div style={{ position: 'relative', width: 600, height: 600, transform: `rotate(${(1 - sweep) * -120}deg)` }}>
        <svg width={600} height={600} style={{ transform: 'rotate(-90deg)' }}>
          {segments.map((s, i) => {
            const len = s.share * circ * sweep;
            const el = <circle key={i} cx={300} cy={300} r={r} fill="none" stroke={s.color} strokeWidth={70} strokeDasharray={`${len} ${circ}`} strokeDashoffset={-offset * sweep} />;
            offset += s.share * circ;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', ...center, transform: `rotate(${(1 - sweep) * 120}deg)` }}>
          <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: -4 }}>{dollars(spent)}</div>
          <div style={{ fontSize: 40, fontWeight: 700, color: C.ink600 }}>spent this month</div>
        </div>
      </div>
      <div style={{ width: 820, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 44, fontWeight: 700 }}>
          <span>Going-out budget</span>
          <span style={{ color: bar >= 0.8 ? '#9A5A0C' : C.ink }}>{Math.round(bar * 100)}%</span>
        </div>
        <div style={{ height: 30, borderRadius: 15, background: C.stone100, overflow: 'hidden' }}>
          <div style={{ height: 30, width: `${bar * 100}%`, background: bar >= 0.8 ? '#E8A94A' : C.leaf, borderRadius: 15 }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  J — Everything rains in; "All your money. One conversation."               */
/* -------------------------------------------------------------------------- */

const CHIPS = ['Pay by @name', 'Splits', 'US stocks', 'Memecoins', 'Any chain', 'Insights', 'Budgets', 'Pots', 'Price alerts', 'Requests'];
export const RAIN = 105;
export function Rain() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tagAt = 52;
  const shake = useShake(tagAt, 26, 12);
  const shake2 = useShake(tagAt + 14, 26, 12);
  const jitter = frame > tagAt + 14 && frame < tagAt + 26 ? Math.sin(frame * 3) * 8 : 0;

  return (
    <AbsoluteFill style={{ ...fill(C.maroon), ...center }}>
      {/* Chips drop from above into a wrapping layout: each lands in its own spot. */}
      <div style={{ position: 'absolute', top: 170, left: 60, right: 60, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 22 }}>
        {CHIPS.map((chip, i) => {
          const at = i * 3;
          const p = spring({ frame: frame - at, fps, config: { damping: 9, stiffness: 120, mass: 1 } });
          const y = interpolate(p, [0, 1], [-1400, 0]);
          const rot = (random(`rot${i}`) - 0.5) * 30 * (1 - p) + (random(`rest${i}`) - 0.5) * 7;
          const fade = interpolate(frame, [tagAt - 6, tagAt], [1, 0.3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={chip} style={{ transform: `translateY(${y}px) rotate(${rot}deg)`, background: C.paper, color: C.maroon, fontSize: 50, fontWeight: 800, padding: '22px 40px', borderRadius: 60, opacity: fade, whiteSpace: 'nowrap' }}>
              {chip}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', top: 980, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div style={shake}>
          <Slam at={tagAt} size={128} color={C.white}>
            All your money.
          </Slam>
        </div>
        <div style={{ ...shake2, position: 'relative' }}>
          {frame >= tagAt + 14 ? (
            <>
              <div style={{ position: 'absolute', inset: 0, transform: `translateX(${jitter}px)`, opacity: 0.5 }}>
                <Slam at={tagAt + 14} size={128} color={C.maroonTint}>
                  One conversation.
                </Slam>
              </div>
            </>
          ) : null}
          <Slam at={tagAt + 14} size={128} color={C.leafBright}>
            One conversation.
          </Slam>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  K — End card                                                               */
/* -------------------------------------------------------------------------- */

export const END = 115;
export function EndV2() {
  const frame = useCurrentFrame();
  const jump = useSpring(4, { damping: 6, stiffness: 120 });
  const shake = useShake(18, 28, 14);
  const line = useSpring(30, { damping: 14 });
  const small = useSpring(44, { damping: 14 });
  const bob = frame > 40 ? Math.sin(frame / 8) * 12 : 0;

  return (
    <AbsoluteFill style={{ ...fill(C.paper), ...center }}>
      <Confetti at={16} y={760} count={110} spread={1.3} />
      <Burst at={18} y={1000} color={C.maroon} />
      <div style={{ ...shake, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div style={{ transform: `translateY(${(1 - jump) * 700 + bob}px) rotate(${Math.sin(frame / 6) * 4}deg)` }}>
          <Mascot pose="blockyhappy" size={420} />
        </div>
        <Slam at={18} size={200} color={C.maroon}>
          Blocky
        </Slam>
        <div style={{ fontSize: 56, fontWeight: 800, textAlign: 'center', maxWidth: 900, lineHeight: 1.2, opacity: line, transform: `translateY(${(1 - line) * 40}px)` }}>
          Tell Blocky what you want to do with your money.
        </div>
        <div style={{ fontSize: 38, fontWeight: 700, color: C.ink600, marginTop: 16, opacity: small, transform: `translateY(${(1 - small) * 30}px)` }}>
          Your keys. Your money. Just ask.
        </div>
      </div>
    </AbsoluteFill>
  );
}

export { Wordmark };
