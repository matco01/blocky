import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colorSchemes, motion, radius, space, type, type ThemeColors } from './tokens';

export * from './tokens';

export interface Theme {
  colors: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  motion: typeof motion;
  scheme: 'light' | 'dark';
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Follows the OS. A manual override lands in Settings later.
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';

  const value = useMemo<Theme>(
    () => ({ colors: colorSchemes[scheme], space, radius, type, motion, scheme }),
    [scheme],
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
