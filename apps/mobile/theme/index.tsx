import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance as SystemAppearance } from 'react-native';
import { EDGE, colorSchemes, motion, radius, space, strokes, type, type ThemeColors } from './tokens';

export * from './tokens';

/** What the user chose. */
export type Appearance = 'light' | 'dark';

export interface Theme {
  colors: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  motion: typeof motion;
  /** Stroke width around a tile: 2 in light, 1 in dark. */
  stroke: number;
  /** Height of the edge under a block. */
  edge: number;
  scheme: 'light' | 'dark';
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const ThemeContext = createContext<Theme | null>(null);

const APPEARANCE_KEY = 'blocky.appearance';

/**
 * The brand is designed light-first, so light is the default until the user
 * picks otherwise on the Account page. The choice is remembered on the device.
 */
const DEFAULT_APPEARANCE: Appearance = 'light';

function isAppearance(value: unknown): value is Appearance {
  return value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    SecureStore.getItemAsync(APPEARANCE_KEY)
      .then((stored) => {
        if (isAppearance(stored)) setAppearanceState(stored);
      })
      .catch(() => {});
  }, []);

  /*
   * Tell the OS which scheme the app is actually in, so system surfaces —
   * alerts, the keyboard — match the app rather than the phone's setting.
   *
   * This does not fix Android's navigation-bar backdrop: on a phone set to
   * dark, a light app still gets a grey band behind the three buttons. That
   * needs expo-navigation-bar, a native module (one rebuild).
   */
  useEffect(() => {
    SystemAppearance.setColorScheme(appearance);
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    void SecureStore.setItemAsync(APPEARANCE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<Theme>(
    () => ({
      colors: colorSchemes[appearance],
      space,
      radius,
      type,
      motion,
      stroke: strokes[appearance],
      edge: EDGE,
      scheme: appearance,
      appearance,
      setAppearance,
    }),
    [appearance, setAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);

  if (!theme) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }

  return theme;
}
