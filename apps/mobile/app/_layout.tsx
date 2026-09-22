import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
} from '@expo-google-fonts/figtree';
import { Ionicons } from '@expo/vector-icons';
import { PrivyProvider, usePrivy } from '@privy-io/expo';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { arcTestnet } from 'viem/chains';
import { setTokenGetter } from '../lib/api';
import { config } from '../lib/config';
import { ThemeProvider, useTheme } from '../theme';

/**
 * Root layout.
 *
 * Privy wraps everything, and the auth gate lives at the router level: the app
 * screens are not merely hidden from a logged-out user, they are not routable.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PrivyProvider
          appId={config.privyAppId}
          {...(config.privyClientId ? { clientId: config.privyClientId } : {})}
          // Arc is the home chain. Privy needs it listed to fetch the nonce when
          // signing the EIP-7702 authorization.
          supportedChains={[arcTestnet]}
          config={{
            // Every user gets an embedded wallet at first login — there is no
            // separate "create wallet" step to explain.
            embedded: { ethereum: { createOnLogin: 'users-without-wallets' } },
          }}
        >
          <ThemeProvider>
            <Gate />
          </ThemeProvider>
        </PrivyProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Gate() {
  const theme = useTheme();
  const { isReady, user, getAccessToken } = usePrivy();

  // Held behind the same loading view as Privy, so the first frame is already in
  // the right face. A load *error* counts as loaded: better the system font than
  // an app that never opens.
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
    ...Ionicons.font,
  });

  // Every API call carries a fresh Privy access token. Privy refreshes it; we
  // just ask for the current one at request time.
  useEffect(() => {
    setTokenGetter(getAccessToken);
  }, [getAccessToken]);

  if (!isReady || (!fontsLoaded && !fontError)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.textTertiary} />
      </View>
    );
  }

  const signedIn = Boolean(user);

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="portfolio" options={{ presentation: 'modal' }} />
          <Stack.Screen name="receive" options={{ presentation: 'modal' }} />
          <Stack.Screen name="activity" options={{ presentation: 'modal' }} />
          <Stack.Screen name="limits" options={{ presentation: 'modal' }} />
          <Stack.Screen name="send" options={{ presentation: 'modal', gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
