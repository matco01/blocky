import { Composition } from 'remotion';
import { FPS } from './brand';
import { PROMO_FRAMES, Promo } from './Promo';
import { PromoV3, V3_FRAMES } from './v3/PromoV3';

/** Vertical, for phones and social: 1080×1920, 25 seconds at 30fps. */
export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={FPS} width={1080} height={1920} />
      {/* v3: square like the inspo, with sound. */}
      <Composition id="PromoV3" component={PromoV3} durationInFrames={V3_FRAMES} fps={FPS} width={1080} height={1080} />
    </>
  );
}
