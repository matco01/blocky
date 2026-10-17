import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

/**
 * A band of the screen's background behind the status bar, for screens whose
 * content scrolls. The app draws under the status bar, so without it a
 * scrolled list slides beneath the clock and the battery and the two overlap.
 * Render it last, so it sits above the scrolling content.
 *
 * `modal`: on iOS a modal is a sheet that already starts below the status bar
 * (see `useModalTopPadding`), so there is nothing to cover — and a band there
 * would cover the sheet's own top instead.
 */
export function StatusBarCover({ modal = false }: { modal?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (insets.top === 0 || (modal && Platform.OS === 'ios')) return null;

  return <View pointerEvents="none" style={[styles.cover, { height: insets.top, backgroundColor: theme.colors.background }]} />;
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
