import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { reportCrash } from '../lib/crash';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

/**
 * If a screen breaks while drawing, show a calm way back instead of a blank
 * app, and tell the server what broke.
 */
export class CrashBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error: unknown) {
    reportCrash(error, 'screen', true);
  }

  render() {
    if (!this.state.broken) return this.props.children;
    return <Fallback onRetry={() => this.setState({ broken: false })} />;
  }
}

/** In the user's own theme: a screen that flashes white in dark mode reads as more broken than it is. */
function Fallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Text variant="heading" style={styles.center}>
        Something went wrong
      </Text>
      <Text variant="body" tone="secondary" style={styles.center}>
        Your money is safe. Blocky has been told what broke.
      </Text>
      <Button label="Try again" variant="ink" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 32, gap: 16 },
  center: { textAlign: 'center' },
});
