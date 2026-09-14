// Polyfills first, before anything that might touch crypto or TextEncoder.
// Privy and viem both need them, and import order is the only guarantee.
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';

import 'expo-router/entry';
