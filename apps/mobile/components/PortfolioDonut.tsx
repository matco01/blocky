import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme';

export interface DonutSlice {
  key: string;
  /** Any positive weight — USD amount is fine; this never touches money math. */
  value: number;
  color: string;
}

const SIZE = 176;
const STROKE = 28;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Surface-color gap between segments, in stroke-length px — the spacer, not a border. */
const GAP = 4;

/**
 * A simple allocation donut: one ring, each slice a plain arc with a surface
 * gap on either side. No hover, no animation — see it, read the legend below it.
 */
export function PortfolioDonut({ slices }: { slices: DonutSlice[] }) {
  const theme = useTheme();
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  let cursor = 0;

  return (
    <Svg width={SIZE} height={SIZE}>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={theme.colors.surfaceMuted} strokeWidth={STROKE} fill="none" />
      {total > 0
        ? slices.map((slice) => {
            const sweep = (slice.value / total) * CIRCUMFERENCE;
            const length = Math.max(sweep - GAP, 0);
            const dashOffset = -cursor;
            cursor += sweep;
            return (
              <Circle
                key={slice.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                stroke={slice.color}
                strokeWidth={STROKE}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                fill="none"
                rotation={-90}
                origin={`${SIZE / 2}, ${SIZE / 2}`}
              />
            );
          })
        : null}
    </Svg>
  );
}
