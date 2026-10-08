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
 * With a `feature`, it is one of the website's feature cards instead: a big
 * rounded colour block, the title set large and tight, and one plain line
 * under it saying what the screen is for. The colour says which part of
 * Blocky you're in, the same colour the website gives it.
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
        styles.close,
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
      style={{
        backgroundColor: theme.colors[FEATURE_KEY[feature]],
        borderRadius: theme.radius.xxl,
        padding: theme.space.xl,
        gap: theme.space.sm,
      }}
    >
      <View style={[styles.row, { alignItems: 'flex-start', gap: theme.space.md }]}>
        <Text variant="display" accessibilityRole="header" style={{ flex: 1, paddingTop: theme.space.xs }}>
          {title}
        </Text>
        {close}
      </View>
      {subtitle ? <Text variant="body">{subtitle}</Text> : null}
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
});
