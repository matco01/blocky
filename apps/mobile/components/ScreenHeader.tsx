import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** The header of a modal screen: a bold title and, optionally, a close square. */
export function ScreenHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Text variant="title">{title}</Text>
      {onClose ? (
        <PressableScale
          onPress={onClose}
          accessibilityLabel="Close"
          haptic="none"
          scaleTo={0.92}
          style={[styles.close, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md }]}
        >
          <Icon name="close" size={20} tone="secondary" />
        </PressableScale>
      ) : null}
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
