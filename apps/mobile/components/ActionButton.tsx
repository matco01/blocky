import { View } from 'react-native';
import { useTheme } from '../theme';
import { BlockPressable } from './BlockPressable';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * Receive, Send, Portfolio — three identical square tiles under the balance.
 * Identical on purpose: one coloured tile in a row of three reads as a carnival.
 * Shortcuts for the things faster to tap than to type; the chat is the main surface.
 */
export function ActionButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: IconName;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <BlockPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      height={68}
      fill={theme.colors.surface}
      edge={theme.colors.borderStrong}
      stroke={theme.colors.border}
      style={{ flex: 1 }}
    >
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Icon name={icon} size={22} />
        <Text variant="caption">{label}</Text>
      </View>
    </BlockPressable>
  );
}
