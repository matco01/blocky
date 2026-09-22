import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export type TileTint = 'accent' | 'brand' | 'warning' | 'danger';

/**
 * A flat surface with a stroke — the one place the stroke lives. Cards, inputs,
 * plan cards, grouped rows. A tinted tile drops the stroke: the colour
 * is the boundary. Tiles are never pressable and never have an edge.
 */
export function Tile({
  children,
  tint,
  muted = false,
  radius,
  style,
}: {
  children?: ReactNode;
  tint?: TileTint;
  /** The quieter fill, for chips and icon squares. */
  muted?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const fill = tint ? theme.colors[`${tint}Tint`] : muted ? theme.colors.surfaceMuted : theme.colors.surface;

  return (
    <View
      style={[
        {
          backgroundColor: fill,
          borderRadius: radius ?? theme.radius.xl,
          borderWidth: tint ? 0 : theme.stroke,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
