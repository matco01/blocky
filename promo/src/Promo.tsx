import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { flip } from '@remotion/transitions/flip';
import { iris } from '@remotion/transitions/iris';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import type { ComponentType } from 'react';
import {
  ASK,
  Ask,
  CHAT,
  ChatV2,
  DROP,
  Drop,
  END,
  EndV2,
  INSIGHTS,
  InsightsV2,
  KINETIC,
  Kinetic,
  MEME,
  Meme,
  POT,
  Pot,
  RAIN,
  Rain,
  STOCK,
  Stock,
  SWAP,
  Swap,
} from './scenes2';

/**
 * v2: faster, louder. Eleven quick scenes, cut together with slides, wipes,
 * flips and an iris — 830 frames of scenes, 80 of them shared by the cuts,
 * for exactly 25 seconds.
 */
const T = 8;
const quick = linearTiming({ durationInFrames: T });
const bouncy = springTiming({ durationInFrames: T, config: { damping: 200 } });

type Cut = ReturnType<typeof slide> | ReturnType<typeof wipe> | ReturnType<typeof flip> | ReturnType<typeof iris>;

const SCENES: Array<{ Scene: ComponentType; frames: number; then?: Cut }> = [
  { Scene: Ask, frames: ASK, then: iris({ width: 1080, height: 1920 }) },
  { Scene: Drop, frames: DROP, then: slide({ direction: 'from-bottom' }) },
  { Scene: Kinetic, frames: KINETIC, then: wipe({ direction: 'from-left' }) },
  { Scene: ChatV2, frames: CHAT, then: slide({ direction: 'from-right' }) },
  { Scene: Stock, frames: STOCK, then: slide({ direction: 'from-right' }) },
  { Scene: Swap, frames: SWAP, then: flip({ direction: 'from-right' }) },
  { Scene: Meme, frames: MEME, then: wipe({ direction: 'from-top' }) },
  { Scene: Pot, frames: POT, then: slide({ direction: 'from-left' }) },
  { Scene: InsightsV2, frames: INSIGHTS, then: wipe({ direction: 'from-bottom' }) },
  { Scene: Rain, frames: RAIN, then: iris({ width: 1080, height: 1920 }) },
  { Scene: EndV2, frames: END },
];

export const PROMO_FRAMES = SCENES.reduce((sum, s) => sum + s.frames, 0) - (SCENES.length - 1) * T;

export function Promo() {
  return (
    <TransitionSeries>
      {SCENES.flatMap(({ Scene, frames, then }, i) => [
        <TransitionSeries.Sequence key={`s${i}`} durationInFrames={frames}>
          <Scene />
        </TransitionSeries.Sequence>,
        ...(then
          ? [<TransitionSeries.Transition key={`t${i}`} presentation={then as never} timing={i % 2 ? bouncy : quick} />]
          : []),
      ])}
    </TransitionSeries>
  );
}
