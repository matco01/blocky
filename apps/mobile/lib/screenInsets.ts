import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

/**
 * Top padding for a modal screen (Receive, Send, Portfolio, Activity, Limits).
 *
 * On iOS a modal is a sheet that already starts below the status bar, so a
 * plain gap is enough. On Android the same screen is full-screen and draws
 * under the status bar — without the inset its title and close button sit
 * right up against the clock and icons.
 */
export function useModalTopPadding(): number {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return Platform.OS === 'ios' ? theme.space.xl : insets.top + theme.space.lg;
}
