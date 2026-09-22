import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme';

const HEIGHT = 120;
const PAD = 8;
/** End-dot radius ≥4px (≥8px diameter) with a surface-colour ring, per mark spec. */
const DOT_R = 4;

/**
 * A plain value-over-time line: one series, one 2px line, one end-dot. No
 * axis, no gridlines — the hero number above already carries the current
 * value; this carries the shape.
 */
export function HistoryChart({ values, width }: { values: number[]; width: number }) {
  const theme = useTheme();
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const plotHeight = HEIGHT - PAD * 2;
  const stepX = width / (values.length - 1);

  const y = (v: number) => (range === 0 ? PAD + plotHeight / 2 : PAD + plotHeight - ((v - min) / range) * plotHeight);
  const coords = values.map((v, i) => ({ x: i * stepX, y: y(v) }));

  const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const last = coords[coords.length - 1];

  return (
    <Svg width={width} height={HEIGHT}>
      <Path d={d} stroke={theme.colors.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {last ? (
        <Circle cx={last.x} cy={last.y} r={DOT_R} fill={theme.colors.accent} stroke={theme.colors.background} strokeWidth={2} />
      ) : null}
    </Svg>
  );
}
