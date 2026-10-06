import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { C, Mascot, PlanCard, Wordmark, fontFamily } from '../brand';
import { Confetti } from '../fx';
import { BlurIn, Cursor, Glow, LiveBlocky, SpeechBubble, text, useBlurOut, useSpringAt } from './kit';

/* -------------------------------------------------------------------------- */
/*  1 · 0–2s — Blocky lands on his name                                        */
/* -------------------------------------------------------------------------- */

export const S1 = 60;
export function Intro() {
  const frame = useCurrentFrame();
  const fall = useSpringAt(4, { damping: 9, stiffness: 120, mass: 1 });
  const y = interpolate(fall, [0, 1], [-900, 0]);
  const speed = Math.abs(interpolate(fall, [0, 0.9, 1], [1, 0.2, 0]));
  const squash = interpolate(frame, [20, 24, 32], [1, 0.75, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const out = useBlurOut(S1);

  return (
    <AbsoluteFill>
      <Glow corner="br" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', ...out }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ transform: `translateY(${y}px) scaleY(${squash}) scaleX(${2 - squash})`, transformOrigin: 'bottom center', filter: `blur(${speed * 14}px)`, marginBottom: -22 }}>
            <LiveBlocky pose={frame > 26 ? 'blockyhappy' : 'blocky'} size={330} blinkAt={[46]} />
          </div>
          <BlurIn at={22}>
            <Wordmark size={170} />
          </BlurIn>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  2 · 2–4s — "Your money. Just ask."                                         */
/* -------------------------------------------------------------------------- */

export const S2 = 60;
export function Promise() {
  const frame = useCurrentFrame();
  const peek = useSpringAt(32, { damping: 9 });
  const out = useBlurOut(S2);
  // grey words settle to black, like the inspo's tagline
  const tone = (at: number) => (frame < at + 8 ? C.ink600 : C.ink);

  return (
    <AbsoluteFill>
      <Glow corner="bl" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 6, ...out }}>
        <div style={{ display: 'flex', gap: 26 }}>
          <BlurIn at={0}>
            <div style={text(120, 800, tone(0))}>Your</div>
          </BlurIn>
          <BlurIn at={6}>
            <div style={text(120, 800, tone(6))}>money.</div>
          </BlurIn>
        </div>
        <div style={{ display: 'flex', gap: 26 }}>
          <BlurIn at={15}>
            <div style={text(120, 800, C.maroon)}>Just</div>
          </BlurIn>
          <BlurIn at={22}>
            <div style={text(120, 800, C.leaf)}>ask.</div>
          </BlurIn>
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', bottom: -40, left: 360, transform: `translateY(${(1 - peek) * 360}px)` }}>
        <LiveBlocky pose="blockyhappy" size={300} blinkAt={[50]} />
        <div style={{ position: 'absolute', top: -10, left: 250 }}>
          <SpeechBubble at={40}>Hi there!</SpeechBubble>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  3 · 4–10s — the phone: ask, plan, approve, sent                            */
/* -------------------------------------------------------------------------- */

export const S3 = 180;
export const CHAT_CUES = { typeFrom: 26, sendAt: 52, thinkEnd: 72, cardAt: 80, tapAt: 128, sentAt: 132 };
export function PhoneDemo() {
  const frame = useCurrentFrame();
  const { typeFrom, sendAt, thinkEnd, cardAt, tapAt, sentAt } = CHAT_CUES;
  const rise = useSpringAt(0, { damping: 16, stiffness: 90 });
  const tiltX = interpolate(rise, [0, 1], [38, 8]);
  const y = interpolate(rise, [0, 1], [900, 0]);
  const push = interpolate(frame, [150, S3], [1, 1.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => t * t });
  const pushBlur = interpolate(frame, [158, S3], [0, 24], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const message = 'Send @sam $20 for lunch';
  const typed = message.slice(0, Math.max(0, Math.min(message.length, Math.floor((frame - typeFrom) * 1.1))));
  const sent = frame >= sendAt;
  const thinking = frame >= sendAt + 4 && frame < thinkEnd;
  const bubble = useSpringAt(sendAt, { damping: 11 });
  const card = useSpringAt(cardAt, { damping: 12, stiffness: 140 });
  const done = frame >= sentAt;
  const check = useSpringAt(sentAt, { damping: 8, stiffness: 220 });

  return (
    <AbsoluteFill>
      <Glow corner="br" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', perspective: 1600 }}>
        <div
          style={{
            marginTop: 110,
            width: 560,
            height: 1100,
            borderRadius: 90,
            background: '#111',
            padding: 16,
            transform: `translateY(${y}px) rotateX(${tiltX}deg) scale(${push})`,
            transformOrigin: '50% 30%',
            filter: `blur(${pushBlur}px)`,
            boxShadow: '0 60px 120px rgba(43,31,26,0.25)',
          }}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 76, background: C.paper, overflow: 'hidden', fontFamily }}>
            {/* dynamic island + status */}
            <div style={{ position: 'absolute', top: 18, left: 190, width: 150, height: 42, borderRadius: 24, background: '#111' }} />
            <div style={{ position: 'absolute', top: 24, left: 44, fontSize: 24, fontWeight: 700 }}>9:41</div>
            {/* header */}
            <div style={{ position: 'absolute', top: 92, left: 0, right: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.maroon }}>Blocky</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: C.ink600, marginTop: 10 }}>Balance</div>
              <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>$6,480.12</div>
            </div>
            {/* chat */}
            <div style={{ position: 'absolute', top: 300, left: 26, right: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {sent ? (
                <div style={{ alignSelf: 'flex-end', background: C.maroonTint, borderRadius: 26, padding: '14px 22px', fontSize: 26, fontWeight: 700, transform: `scale(${bubble})`, transformOrigin: 'right center' }}>
                  {message}
                </div>
              ) : null}
              {sent ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ transform: done ? `translateY(${-Math.max(0, Math.sin(((frame - sentAt) / 12) * Math.PI)) * 30}px)` : thinking ? `rotate(${Math.sin(frame / 2) * 8}deg)` : undefined }}>
                    <Mascot pose={thinking ? 'blockyclosedeyes' : 'blockyhappy'} size={84} />
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: thinking ? C.ink600 : C.ink }}>
                    {thinking ? `thinking${'.'.repeat(1 + (Math.floor(frame / 4) % 3))}` : done ? 'Sent! Lunch is paid.' : 'On it! Tap to approve.'}
                  </div>
                </div>
              ) : null}
              {frame >= cardAt ? (
                <div style={{ transform: `translateY(${(1 - card) * 300}px)`, transformOrigin: 'center', zoom: 0.58 }}>
                  <PlanCard
                    verb="Send"
                    amount="$20.00"
                    line="to @sam"
                    detail="Instant · No Blocky fee"
                    status={done ? '✓ Sent' : 'Needs approval'}
                    statusTone={done ? 'good' : 'muted'}
                    style={{ width: 860 }}
                  />
                  {!done ? (
                    <div style={{ marginTop: 22, background: C.leaf, color: C.white, borderRadius: 60, padding: '26px 0', textAlign: 'center', fontSize: 44, fontWeight: 800, transform: `scale(${frame >= tapAt && frame < tapAt + 5 ? 0.95 : 1})` }}>
                      Approve $20.00
                    </div>
                  ) : (
                    <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
                      <div style={{ width: 150, height: 150, borderRadius: 75, background: C.leaf, color: C.white, fontSize: 96, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${check})` }}>✓</div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            {/* input */}
            <div style={{ position: 'absolute', bottom: 34, left: 24, right: 24, background: C.white, border: `3px solid ${C.stone200}`, borderRadius: 40, padding: '18px 24px', fontSize: 25, fontWeight: 600, color: sent || !typed ? C.ink600 : C.ink }}>
              {sent ? 'Ask Blocky…' : typed || 'Ask Blocky…'}
              {!sent && frame >= typeFrom ? <span style={{ color: C.leaf, opacity: Math.floor(frame / 5) % 2 }}>|</span> : null}
            </div>
          </div>
        </div>
      </AbsoluteFill>
      <Cursor
        path={[
          { at: 96, x: 900, y: 1000 },
          { at: 124, x: 560, y: 835 },
          { at: 150, x: 600, y: 860 },
        ]}
        pressAt={[tapAt]}
      />
      <Confetti at={sentAt} x={540} y={800} count={80} />
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  4 · 10–13s — All your money: a wobbly cluster                              */
/* -------------------------------------------------------------------------- */

const BUBBLES = [
  { label: 'USDC', sub: '$6,480', color: '#2775CA', x: -250, y: -150, r: 105 },
  { label: 'ETH', sub: '$412', color: '#627EEA', x: 230, y: -190, r: 95 },
  { label: 'AAPL', sub: 'Apple', color: '#1D1D1F', x: 280, y: 110, r: 100 },
  { label: 'NVDA', sub: 'Nvidia', color: C.leaf, x: -290, y: 140, r: 90 },
  { label: 'DEGEN', sub: 'meme', color: '#7C4DDB', x: 20, y: 250, r: 80 },
  { label: 'Trip', sub: 'pot', color: '#E8A94A', x: -40, y: -290, r: 78 },
];
export const S4 = 90;
export function Cluster() {
  const frame = useCurrentFrame();
  const out = useBlurOut(S4);
  const blob = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const r = 400 + Math.sin(frame / 9 + i * 1.7) * 26;
    return [540 + Math.cos(a) * r, 430 + Math.sin(a) * r * 0.82] as const;
  });
  const d = blob.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + 'Z';
  const center = useSpringAt(4, { damping: 8 });

  return (
    <AbsoluteFill>
      <Glow corner="tr" />
      <AbsoluteFill style={out}>
        <svg width={1080} height={1080} style={{ position: 'absolute', inset: 0 }}>
          <path d={d} fill={C.leafTint} opacity={0.7} style={{ filter: 'blur(6px)' }} />
        </svg>
        <div style={{ position: 'absolute', left: 540 - 130, top: 430 - 150, transform: `scale(${center})` }}>
          <LiveBlocky pose="blockyhappy" size={260} blinkAt={[60]} />
        </div>
        {BUBBLES.map((b, i) => {
          const p = useSpringAt(8 + i * 5, { damping: 8, stiffness: 200 });
          const bob = Math.sin(frame / 10 + i) * 12;
          return (
            <div
              key={b.label}
              style={{
                position: 'absolute',
                left: 540 + b.x - b.r,
                top: 430 + b.y - b.r + bob,
                width: b.r * 2,
                height: b.r * 2,
                borderRadius: '50%',
                background: b.color,
                border: '8px solid white',
                boxShadow: '0 16px 36px rgba(43,31,26,0.18)',
                color: C.white,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily,
                transform: `scale(${p})`,
              }}
            >
              <div style={{ fontSize: b.r * 0.36, fontWeight: 800 }}>{b.label}</div>
              <div style={{ fontSize: b.r * 0.2, fontWeight: 700, opacity: 0.85 }}>{b.sub}</div>
            </div>
          );
        })}
        <div style={{ position: 'absolute', bottom: 90, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 22 }}>
          <BlurIn at={30}>
            <div style={text(84)}>All your money.</div>
          </BlurIn>
        </div>
        <div style={{ position: 'absolute', bottom: 30, left: 0, right: 0, textAlign: 'center' }}>
          <BlurIn at={45}>
            <div style={text(44, 700, C.ink600)}>One place. Every chain.</div>
          </BlurIn>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  5 · 13–16s — friends: pay, request, split                                  */
/* -------------------------------------------------------------------------- */

const FRIENDS = [
  { name: '@sam', pill: 'paid you $20', tone: C.leaf, tint: C.leafTint, color: '#F2826F', letter: 'S' },
  { name: '@ana', pill: 'owes you $12', tone: '#9A5A0C', tint: '#FBEFD9', color: '#7DBE5A', letter: 'A' },
  { name: '@leo', pill: 'split dinner', tone: '#7C4DDB', tint: '#EFE7FF', color: '#627EEA', letter: 'L' },
];
export const S5 = 90;
export const FRIEND_CUES = { tapAt: 52, paidAt: 58 };
export function Friends() {
  const frame = useCurrentFrame();
  const out = useBlurOut(S5);
  const focus = interpolate(frame, [30, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => 1 - Math.pow(1 - t, 3) });
  const paid = frame >= FRIEND_CUES.paidAt;
  const flip = useSpringAt(FRIEND_CUES.paidAt, { damping: 9 });

  return (
    <AbsoluteFill>
      <Glow corner="bl" color="#7DBE5A" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', ...out }}>
        <BlurIn at={0} style={{ position: 'absolute', top: 120 }}>
          <div style={text(64)}>Pay friends by name.</div>
        </BlurIn>
        <div style={{ display: 'flex', gap: 60, marginTop: 40 }}>
          {FRIENDS.map((f, i) => {
            const p = useSpringAt(4 + i * 5, { damping: 10 });
            const isAna = i === 1;
            const scale = isAna ? 1 + focus * 0.18 : 1 - focus * 0.1;
            const blur = isAna ? 0 : focus * 8;
            const showPaid = isAna && paid;
            return (
              <div key={f.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, transform: `scale(${p * scale})`, filter: `blur(${blur}px)`, opacity: isAna ? 1 : 1 - focus * 0.5 }}>
                <div style={{ width: 200, height: 200, borderRadius: 100, background: f.color, border: '8px solid white', boxShadow: '0 16px 36px rgba(43,31,26,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...text(96, 800, C.white) }}>
                  {f.letter}
                </div>
                <div style={text(48, 800)}>{f.name}</div>
                <div
                  style={{
                    fontFamily,
                    fontSize: 32,
                    fontWeight: 800,
                    color: showPaid ? C.leaf : f.tone,
                    background: showPaid ? C.leafTint : f.tint,
                    padding: '10px 24px',
                    borderRadius: 30,
                    transform: showPaid ? `scale(${0.7 + flip * 0.3})` : undefined,
                  }}
                >
                  {showPaid ? 'paid ✓' : f.pill}
                </div>
                {isAna ? (
                  <div style={{ height: 70, marginTop: 6 }}>
                    {frame >= 38 && !paid ? (
                      <BlurIn at={38} from={20} rise={10}>
                        <div style={{ fontFamily, fontSize: 30, fontWeight: 800, color: C.white, background: C.maroon, padding: '14px 28px', borderRadius: 34, transform: `scale(${frame >= FRIEND_CUES.tapAt && frame < FRIEND_CUES.tapAt + 5 ? 0.93 : 1})` }}>
                          Request $12
                        </div>
                      </BlurIn>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <Cursor
        path={[
          { at: 40, x: 980, y: 1000 },
          { at: 52, x: 560, y: 790 },
          { at: 80, x: 600, y: 820 },
        ]}
        pressAt={[FRIEND_CUES.tapAt]}
      />
      <Confetti at={FRIEND_CUES.paidAt} x={540} y={560} count={40} spread={0.7} />
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  6 · 16–19s — the pot fills; Blocky goes nervous → thrilled                 */
/* -------------------------------------------------------------------------- */

export const S6 = 90;
export const COINS_AT = [10, 22, 34, 46];
export function Pot() {
  const frame = useCurrentFrame();
  const out = useBlurOut(S6);
  const landed = COINS_AT.filter((at) => frame >= at + 14).length;
  const level = interpolate(landed, [0, COINS_AT.length], [0.1, 0.62]);
  const shown = Math.round(interpolate(level, [0.1, 0.62], [40, 310]));
  const thrilled = frame >= COINS_AT[COINS_AT.length - 1]! + 16;

  return (
    <AbsoluteFill>
      <Glow corner="br" color="#E8A94A" />
      <AbsoluteFill style={out}>
        <BlurIn at={0} style={{ position: 'absolute', top: 90, left: 0, right: 0, textAlign: 'center' }}>
          <div style={text(40, 700, C.ink600)}>Savings pot</div>
          <div style={text(78, 800, C.maroon)}>Trip to Lisbon</div>
        </BlurIn>
        <div style={{ position: 'absolute', left: 170, top: 330, width: 380, height: 500 }}>
          {COINS_AT.map((at, i) => {
            const t = frame - at;
            if (t < 0 || t > 14) return null;
            const y = interpolate(t, [0, 14], [-420, 440 - level * 360], { easing: (x) => x * x });
            return (
              <div key={i} style={{ position: 'absolute', left: 110 + ((i * 47) % 120), top: y, width: 100, height: 100, borderRadius: 50, background: '#E8A94A', border: '8px solid #9A5A0C', display: 'flex', alignItems: 'center', justifyContent: 'center', ...text(52, 800, '#9A5A0C'), transform: `rotate(${t * 20}deg)` }}>
                $
              </div>
            );
          })}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '60px 60px 80px 80px', border: `12px solid ${C.maroon}`, overflow: 'hidden', background: 'rgba(255,255,255,0.6)' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${level * 100}%`, background: `linear-gradient(${C.leafBright}, ${C.leaf})`, transition: 'none' }} />
          </div>
        </div>
        <div style={{ position: 'absolute', right: 150, top: 470 }}>
          <LiveBlocky pose={thrilled ? 'blockyhappy' : 'blockyleftlook'} size={250} hopAt={thrilled ? COINS_AT[COINS_AT.length - 1]! + 16 : undefined} />
          {thrilled ? (
            <div style={{ position: 'absolute', top: -70, left: -40 }}>
              <SpeechBubble at={COINS_AT[COINS_AT.length - 1]! + 18}>Nice!</SpeechBubble>
            </div>
          ) : null}
        </div>
        <div style={{ position: 'absolute', bottom: 90, left: 0, right: 0, textAlign: 'center', ...text(96) }}>
          ${shown} <span style={{ ...text(52, 700, C.ink600) }}>of $500</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  7 · 19–22s — floating features, bursting on the drop                       */
/* -------------------------------------------------------------------------- */

const ICONS = [
  { glyph: '▲', label: 'Stocks', color: '#1D1D1F', x: -300, y: -170, z: 1 },
  { glyph: '@', label: 'Pay by name', color: C.maroon, x: 40, y: -250, z: 0.7 },
  { glyph: 'Ξ', label: 'Crypto', color: '#627EEA', x: 300, y: -110, z: 0.9 },
  { glyph: '!', label: 'Alerts', color: '#E8A94A', x: -260, y: 170, z: 0.75 },
  { glyph: '◔', label: 'Insights', color: C.leaf, x: -20, y: 260, z: 1.05 },
  { glyph: '$', label: 'Pots', color: '#7C4DDB', x: 330, y: 230, z: 0.8 },
];
export const S7 = 90;
export const DROP_AT = 30; // 20.0s
export function Icons() {
  const frame = useCurrentFrame();
  const out = useBlurOut(S7);
  const burst = interpolate(frame, [DROP_AT, DROP_AT + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => 1 - Math.pow(1 - t, 3) });

  return (
    <AbsoluteFill>
      <Glow corner="br" />
      <AbsoluteFill style={out}>
        {ICONS.map((icon, i) => {
          const p = useSpringAt(i * 3, { damping: 10 });
          const drift = Math.sin(frame / 14 + i) * 16;
          const spread = 1 + burst * 0.35;
          const size = 170 * icon.z;
          const blur = icon.z < 0.8 ? (0.8 - icon.z) * 30 : 0;
          return (
            <div
              key={icon.label}
              style={{
                position: 'absolute',
                left: 540 + icon.x * spread - size / 2,
                top: 470 + icon.y * spread - size / 2 + drift,
                width: size,
                height: size,
                borderRadius: size * 0.27,
                background: icon.color,
                boxShadow: '0 22px 50px rgba(43,31,26,0.22)',
                border: '6px solid rgba(255,255,255,0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily,
                fontWeight: 800,
                fontSize: size * 0.45,
                color: C.white,
                filter: `blur(${blur}px)`,
                transform: `scale(${p}) rotate(${Math.sin(frame / 20 + i) * 8 + (1 - p) * 30}deg)`,
              }}
            >
              {icon.glyph}
            </div>
          );
        })}
        <div style={{ position: 'absolute', left: 540 - 120, top: 470 - 130 }}>
          <LiveBlocky pose="blockyhappy" size={240} hopAt={DROP_AT} />
        </div>
        <div style={{ position: 'absolute', bottom: 70, left: 0, right: 0, textAlign: 'center' }}>
          <BlurIn at={DROP_AT + 4}>
            <div style={text(66)}>Send. Buy. Save. Track.</div>
          </BlurIn>
        </div>
      </AbsoluteFill>
      <Confetti at={DROP_AT} x={540} y={470} count={60} />
    </AbsoluteFill>
  );
}

/* -------------------------------------------------------------------------- */
/*  8 · 22–25s — logo, tagline, a wink on the final hit                        */
/* -------------------------------------------------------------------------- */

export const S8 = 90;
export const HIT_AT = 45; // 23.5s
export function Logo() {
  const frame = useCurrentFrame();
  const icon = useSpringAt(0, { damping: 11 });
  const tone = (at: number) => (frame < at + 8 ? C.ink600 : C.ink);
  // A short, clean fade to paper at the very end — not to a muddy dark.
  const fadeOut = interpolate(frame, [S8 - 8, S8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <Glow corner="br" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <BlurIn at={0} from={40}>
          <div style={{ width: 260, height: 260, borderRadius: 64, background: C.paper, border: `5px solid ${C.stone200}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 30px 70px rgba(114,52,49,0.28)', transform: `scale(${0.8 + icon * 0.2})` }}>
            <LiveBlocky pose="blockyhappy" size={210} blinkAt={[HIT_AT, HIT_AT + 12]} hopAt={HIT_AT} />
          </div>
        </BlurIn>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
            <BlurIn at={12}>
              <div style={text(76, 700, tone(12))}>Your</div>
            </BlurIn>
            <BlurIn at={16}>
              <div style={text(76, 700, tone(16))}>money,</div>
            </BlurIn>
          </div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
            <BlurIn at={24}>
              <div style={text(76, 800, C.maroon)}>by</div>
            </BlurIn>
            <BlurIn at={28}>
              <div style={text(76, 800, C.maroon)}>talking.</div>
            </BlurIn>
          </div>
        </div>
        <BlurIn at={HIT_AT}>
          <Wordmark size={64} color={C.ink600} />
        </BlurIn>
      </AbsoluteFill>
      <Confetti at={HIT_AT} x={540} y={300} count={70} />
      <AbsoluteFill style={{ background: '#FFFEFC', opacity: fadeOut }} />
    </AbsoluteFill>
  );
}

export { random };
