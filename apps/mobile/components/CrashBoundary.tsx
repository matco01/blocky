import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { reportCrash } from '../lib/crash';
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
    return (
      <View style={styles.screen}>
        <Text variant="heading" style={styles.center}>
          Something went wrong
        </Text>
        <Text variant="body" tone="secondary" style={styles.center}>
          Your money is safe. Blocky has been told what broke.
        </Text>
        <Button label="Try again" variant="ink" onPress={() => this.setState({ broken: false })} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 32, gap: 16, backgroundColor: '#FFFCF8' },
  center: { textAlign: 'center' },
});
