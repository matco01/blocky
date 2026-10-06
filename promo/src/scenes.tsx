import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, spring, Easing } from 'remotion';
import { Bubble, C, Mascot, PlanCard, Screen, Wordmark, fontFamily, sec, usePop, useRise, useSceneOut, useTyped } from './brand';

/* -------------------------------------------------------------------------- */
/*  1. Blocky lands on the wordmark                                            */
/* -------------------------------------------------------------------------- */

export function Landing() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const length = sec(3);

  // Falls from above the frame and lands with a bounce at ~1s.
  const fall = spring({ frame: frame - 6, fps, config: { damping: 9, stiffness: 90, mass: 1.1 } });
  const y = interpolate(fall, [0, 1], [-1300, 0]);
  // A squash the moment it touches down.
  const squash = interpolate(frame, [28, 32, 40], [1, 0.82, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const word = usePop(26, { damping: 11 });
  const out = useSceneOut(length);

  return (
    <Screen>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: out }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ transform: `translateY(${y}px) scaleY(${squash}) scaleX(${2 - squash})`, transformOrigin: 'bottom center', marginBottom: -34 }}>
            <Mascot pose={frame > 40 ? 'blockyhappy' : 'blocky'} size={420} />
          </div>
          <div style={{ transform: `scale(${0.8 + word * 0.2}) translateY(${(1 - word) * 30}px)`, opacity: word }}>
            <Wordmark size={190} />
          </div>
        </div>
      </AbsoluteFill>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. "Your money. By talking."                                               */
/* -------------------------------------------------------------------------- */

export function Tagline() {
  const length = sec(3.5);
  const out = useSceneOut(length);
  const words = [
    { text: 'Your', at: 4 },
    { text: 'money.', at: 12 },
    { text: 'By', at: 34, tone: C.maroon },
    { text: 'talking.', at: 42, tone: C.maroon },
  ];
  const frame = useCurrentFrame();
  const underline = interpolate(frame, [58, 78], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  return (
    <Screen>
      <div style={{ opacity: out, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 34 }}>
          {words.slice(0, 2).map((w) => (
            <Word key={w.text} {...w} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 34, position: 'relative' }}>
          {words.slice(2).map((w) => (
            <Word key={w.text} {...w} />
          ))}
          <div style={{ position: 'absolute', left: 0, bottom: -6, height: 14, borderRadius: 7, background: C.leafBright, width: `${underline * 100}%` }} />
        </div>
      </div>
    </Screen>
  );
}

function Word({ text, at, tone = C.ink }: { text: string; at: number; tone?: string }) {
  const style = useRise(at, 60);
  return <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -5, color: tone, ...style }}>{text}</div>;
}

/* -------------------------------------------------------------------------- */
/*  3. A send, the way it really goes                                          */
/* -------------------------------------------------------------------------- */

export function Chat() {
  const frame = useCurrentFrame();
  const length = sec(7);
  const out = useSceneOut(length);

  const message = 'Send @sam $20 for lunch';
  const typed = useTyped(message, 8, 38);
  const sentAt = 52;
  const bubbleIn = usePop(sentAt);
  const thinking = frame > sentAt + 4 && frame < sentAt + 34;
  const replyIn = useRise(sentAt + 34, 30);
  const cardIn = usePop(sentAt + 44, { damping: 13 });

  // The fingerprint moment, then the card turns to "Sent".
  const touchAt = sentAt + 96;
  const touch = usePop(touchAt, { damping: 10 });
  const sent = frame > touchAt + 26;
  const check = usePop(touchAt + 26, { damping: 9 });

  return (
    <Screen background={C.stone100}>
      <AbsoluteFill style={{ opacity: out, padding: '0 90px', justifyContent: 'center', gap: 36, display: 'flex', flexDirection: 'column' }}>
        {/* The typed message, before it's sent */}
        {frame < sentAt ? (
          <div
            style={{
              alignSelf: 'stretch',
              background: C.white,
              border: `4px solid ${C.stone200}`,
              borderRadius: 60,
              padding: '34px 44px',
              fontSize: 46,
              fontWeight: 600,
              color: typed ? C.ink : C.ink600,
            }}
          >
            {typed || 'Ask Blocky…'}
            <span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0, color: C.leaf }}>|</span>
          </div>
        ) : (
          <>
            <Bubble from="user" style={{ transform: `scale(${0.85 + bubbleIn * 0.15})`, opacity: bubbleIn, transformOrigin: 'right center' }}>
              {message}
            </Bubble>

            <div style={{ display: 'flex', alignItems: 'center', gap: 26, minHeight: 170 }}>
              <Mascot pose={thinking ? 'blockyclosedeyes' : 'blockyhappy'} size={170} style={{ transform: thinking ? `rotate(${Math.sin(frame / 3) * 4}deg)` : undefined }} />
              {thinking ? (
                <div style={{ fontSize: 44, fontWeight: 600, color: C.ink600 }}>thinking{'.'.repeat(1 + (Math.floor(frame / 6) % 3))}</div>
              ) : (
                <div style={{ fontSize: 44, fontWeight: 600, ...replyIn }}>Here it is — approve when you're ready.</div>
              )}
            </div>

            <div style={{ transform: `translateY(${(1 - cardIn) * 200}px) scale(${0.9 + cardIn * 0.1})`, opacity: cardIn, alignSelf: 'center' }}>
              <PlanCard
                verb="Send"
                amount="$20.00"
                line="to @sam"
                detail="Arrives instantly · No Blocky fee"
                status={sent ? '✓ Sent' : 'Needs approval'}
                statusTone={sent ? 'good' : 'muted'}
              />
            </div>

            {/* Fingerprint */}
            <div style={{ alignSelf: 'center', height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {frame > touchAt - 10 ? (
                sent ? (
                  <div
                    style={{
                      width: 170,
                      height: 170,
                      borderRadius: 85,
                      background: C.leaf,
                      color: C.white,
                      fontSize: 100,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `scale(${check})`,
                    }}
                  >
                    ✓
                  </div>
                ) : (
                  <Fingerprint pulse={touch} />
                )
              ) : null}
            </div>
          </>
        )}
      </AbsoluteFill>
    </Screen>
  );
}

function Fingerprint({ pulse }: { pulse: number }) {
  const rings = [0, 1, 2, 3];
  return (
    <div style={{ position: 'relative', width: 170, height: 170, transform: `scale(${0.8 + pulse * 0.2})` }}>
      <div
        style={{
          position: 'absolute',
          inset: -40 * pulse,
          borderRadius: 400,
          border: `6px solid ${C.leafBright}`,
          opacity: 1 - pulse,
        }}
      />
      {rings.map((r) => (
        <div
          key={r}
          style={{
            position: 'absolute',
            left: 85 - (30 + r * 18),
            top: 85 - (30 + r * 18),
            width: (30 + r * 18) * 2,
            height: (30 + r * 18) * 2,
            borderRadius: 200,
            border: `7px solid ${C.maroon}`,
            borderBottomColor: 'transparent',
            opacity: 0.9 - r * 0.15,
          }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. More than sending: stocks, crypto, pots                                 */
/* -------------------------------------------------------------------------- */

export function Montage() {
  const frame = useCurrentFrame();
  const beat = sec(1.5);
  const length = beat * 3;
  const out = useSceneOut(length);
  const index = Math.min(2, Math.floor(frame / beat));
  const local = frame - index * beat;

  const cards = [
    { ask: 'Buy $50 of Apple', verb: 'Buy', amount: '$50.00', line: 'of Apple', detail: 'About 0.147 AAPL · in 2 seconds' },
    { ask: 'Get $30 of ETH on Base', verb: 'Swap', amount: '$30.00', line: 'into ETH on Base', detail: 'Cheapest route, picked for you' },
    { ask: 'Put $200 aside for my trip', verb: 'Pot', amount: '$200.00', line: 'Trip to Lisbon', detail: 'pot' },
  ] as const;
  const card = cards[index]!;

  const enter = spring({ frame: local, fps: 30, config: { damping: 13, stiffness: 140 } });
  const leave = interpolate(local, [beat - 7, beat], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const x = (1 - enter) * 900 - leave * 900;
  const fill = interpolate(local, [10, 36], [0.12, 0.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  return (
    <Screen background={C.paper}>
      <AbsoluteFill style={{ opacity: out, alignItems: 'center', justifyContent: 'center', gap: 60, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 56, fontWeight: 700, color: C.maroon, transform: `translateX(${x}px)` }}>“{card.ask}”</div>
        <div style={{ transform: `translateX(${x}px)` }}>
          {card.verb === 'Pot' ? (
            <div
              style={{
                width: 860,
                background: C.white,
                borderRadius: 48,
                border: `4px solid ${C.stone200}`,
                boxShadow: '0 30px 80px rgba(43,31,26,0.10)',
                padding: '48px 52px',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 600, color: C.ink600 }}>Savings pot</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 60, fontWeight: 800 }}>{card.line}</div>
                <div style={{ fontSize: 44, fontWeight: 700 }}>${Math.round(fill * 500)}</div>
              </div>
              <div style={{ height: 26, borderRadius: 13, background: C.stone100, overflow: 'hidden' }}>
                <div style={{ height: 26, borderRadius: 13, width: `${fill * 100}%`, background: C.leaf }} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 500, color: C.ink600 }}>{Math.round(fill * 100)}% of $500 · still in your wallet</div>
            </div>
          ) : (
            <PlanCard verb={card.verb} amount={card.amount} line={card.line} detail={card.detail} status="Needs approval" />
          )}
        </div>
        <div style={{ transform: `translateY(${Math.sin(frame / 7) * 10}px)`, marginTop: 20 }}>
          <Mascot pose={index === 1 ? 'blockyrightlook' : 'blockyleftlook'} size={260} />
        </div>
      </AbsoluteFill>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Everything, one conversation                                            */
/* -------------------------------------------------------------------------- */

const FEATURES = [
  'Pay by @name',
  'Requests & splits',
  'US stocks',
  'Any token',
  'Move between chains',
  'Insights & budgets',
  'Savings pots',
  'Price alerts',
];

export function Features() {
  const length = sec(3.5);
  const out = useSceneOut(length);
  const head = useRise(46, 40);

  return (
    <Screen background={C.maroon}>
      <AbsoluteFill style={{ opacity: out, alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 80, padding: 80 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center', maxWidth: 940 }}>
          {FEATURES.map((feature, i) => (
            <Chip key={feature} text={feature} delay={i * 4} />
          ))}
        </div>
        <div style={{ textAlign: 'center', color: C.white, ...head }}>
          <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -3, lineHeight: 1.1 }}>All your money.</div>
          <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -3, lineHeight: 1.1, color: C.leafBright }}>One conversation.</div>
        </div>
      </AbsoluteFill>
    </Screen>
  );
}

function Chip({ text, delay }: { text: string; delay: number }) {
  const p = usePop(delay, { damping: 11, stiffness: 160 });
  return (
    <div
      style={{
        fontFamily,
        fontSize: 42,
        fontWeight: 700,
        color: C.maroon,
        background: C.paper,
        borderRadius: 60,
        padding: '22px 38px',
        transform: `scale(${p}) rotate(${(1 - p) * -8}deg)`,
        opacity: p,
      }}
    >
      {text}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  6. The end card                                                            */
/* -------------------------------------------------------------------------- */

export function EndCard() {
  const frame = useCurrentFrame();
  const mascot = usePop(2, { damping: 10 });
  const word = usePop(10, { damping: 12 });
  const line = useRise(20, 30);
  const small = useRise(30, 20);
  const bob = Math.sin(frame / 10) * 8;

  return (
    <Screen>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <div style={{ transform: `scale(${mascot}) translateY(${bob}px)` }}>
          <Mascot pose="blockyhappy" size={360} />
        </div>
        <div style={{ transform: `scale(${0.85 + word * 0.15})`, opacity: word }}>
          <Wordmark size={170} />
        </div>
        <div style={{ fontSize: 50, fontWeight: 700, textAlign: 'center', maxWidth: 860, lineHeight: 1.25, ...line }}>
          Tell Blocky what you want to do with your money.
        </div>
        <div style={{ fontSize: 34, fontWeight: 600, color: C.ink600, marginTop: 20, ...small }}>Your keys. Your money. Just ask.</div>
      </div>
    </Screen>
  );
}
