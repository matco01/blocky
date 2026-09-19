import { StyleSheet, View } from 'react-native';
import { palette, useTheme } from '../theme';
import { Text } from './Text';

/**
 * The Blocky card, as it will look — a preview, not a card.
 *
 * Standard card proportions (ISO 7810, 85.6 × 54 mm). No card-network logo
 * and no number: there is no card yet, and showing either would suggest there
 * is. The soft shapes are plain views, so the design needs no gradient library.
 */
export function BlockyCard() {
  const theme = useTheme();

  return (
    <View
      style={[styles.card, { backgroundColor: palette.maroon900, borderRadius: theme.radius.xl }]}
      accessibilityLabel="Blocky card preview, coming soon"
    >
      {/* Depth: the mascot's two colours, bleeding off the edges. */}
      <View style={[styles.glow, styles.glowTop, { backgroundColor: palette.leaf700 }]} />
      <View style={[styles.glow, styles.glowBottom, { backgroundColor: palette.maroon600 }]} />

      <View style={styles.top}>
        <Text variant="heading" style={styles.onCard}>
          Blocky
        </Text>
        <View style={[styles.chip, { borderRadius: theme.radius.sm }]}>
          <Text variant="caption" style={styles.onCard}>
            Coming soon
          </Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <View style={styles.contact} />
        <Text variant="label" style={[styles.onCard, styles.muted]}>
          Spend your USDC balance
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 85.6 / 54,
    padding: 22,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    opacity: 0.35,
  },
  glowTop: {
    top: -120,
    right: -80,
  },
  glowBottom: {
    bottom: -150,
    left: -70,
    opacity: 0.45,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // The contact chip, as a quiet rounded rectangle.
  contact: {
    width: 40,
    height: 30,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  onCard: {
    color: palette.white,
  },
  muted: {
    opacity: 0.8,
  },
});
