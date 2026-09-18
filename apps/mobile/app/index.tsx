import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { AccountPage } from '../components/pages/AccountPage';
import { HomePage } from '../components/pages/HomePage';
import { useKeyboardVisible } from '../lib/keyboard';
import { useTheme } from '../theme';

/**
 * The home pager: Home, and one swipe left, Account.
 *
 * A paging ScrollView rather than a native pager, so it needs no native module
 * and no rebuild. Both pages stay mounted, so the chat keeps its conversation
 * while you look at your account.
 */
export default function HomePager() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  // Swiping away mid-sentence would be a surprise; hold the pager while typing.
  const typing = useKeyboardVisible();

  const goToPage = useCallback(
    (next: number) => {
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
      setPage(next);
    },
    [width],
  );

  const onScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPage(Math.round(event.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  // On Account, the system back gesture returns to Home instead of leaving the app.
  useEffect(() => {
    if (page === 0) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goToPage(0);
      return true;
    });
    return () => subscription.remove();
  }, [page, goToPage]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      scrollEnabled={!typing}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onMomentumScrollEnd={onScrollEnd}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <View style={{ width }}>
        <HomePage page={page} onPageChange={goToPage} />
      </View>
      <View style={{ width }}>
        <AccountPage page={page} onPageChange={goToPage} />
      </View>
    </ScrollView>
  );
}
