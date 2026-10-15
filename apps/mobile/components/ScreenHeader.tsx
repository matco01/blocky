import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** The website's feature colours: paying people, savings, investing, spending. */
export type Feature = 'leaf' | 'maroon' | 'amber' | 'sand';

const FEATURE_KEY = {
  leaf: 'featureLeaf',
  maroon: 'featureMaroon',
  amber: 'featureAmber',
  sand: 'featureSand',
} as const;

/**
 * The header of a modal screen: a bold title and, optionally, a close square.
 *
 * With a `feature`, it is a slim bar in one of the website's feature colours:
 * just the title and the close square. The colour says which part of Blocky
 * you're in, the same colour the website gives it. `subtitle` is read out to
 * screen readers rather than shown, to keep the bar small.
 */
export function ScreenHeader({
  title,
  onClose,
  feature,
  subtitle,
}: {
  title: string;
  onClose?: () => void;
  feature?: Feature;
  subtitle?: string;
}) {
  const theme = useTheme();

  const close = onClose ? (
    <PressableScale
      onPress={onClose}
      accessibilityLabel="Close"
      haptic="none"
      scaleTo={0.92}
      style={[
        feature ? styles.closeSmall : styles.close,
        {
          backgroundColor: feature ? theme.colors.surface : theme.colors.surfaceMuted,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <Icon name="close" size={20} tone="secondary" />
    </PressableScale>
  ) : null;

  if (!feature) {
    return (
      <View style={styles.row}>
        <Text variant="title">{title}</Text>
        {close}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.colors[FEATURE_KEY[feature]],
          borderRadius: theme.radius.xl,
          paddingVertical: theme.space.md,
          paddingLeft: theme.space.lg + 2,
          paddingRight: theme.space.md,
          gap: theme.space.md,
        },
      ]}
    >
      <Text variant="heading" accessibilityRole="header" accessibilityHint={subtitle} style={{ flex: 1 }}>
        {title}
      </Text>
      {close}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  close: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeSmall: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
