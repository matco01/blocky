import { ActivityIndicator } from 'react-native';
import { font, useTheme } from '../theme';
import { BlockPressable, type BlockPressableProps } from './BlockPressable';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /**
   * `danger` is for signing out and the like: a plain block with a red label.
   * `ink` is the website's dark block, for getting started — never for moving money.
   */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'ink';
  loading?: boolean;
  disabled?: boolean;
  haptic?: BlockPressableProps['haptic'];
  /** `compact` for buttons inside cards. */
  size?: 'regular' | 'compact';
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  haptic = 'light',
  size = 'regular',
}: ButtonProps) {
  const theme = useTheme();
  // A loading button must not accept a second tap: that is how a send gets submitted twice.
  const blocked = disabled || loading;

  if (variant === 'quiet') {
    return (
      <PressableScale onPress={onPress} disabled={blocked} haptic={haptic} accessibilityLabel={label} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
        {loading ? (
          <ActivityIndicator color={theme.colors.textSecondary} />
        ) : (
          <Text variant="bodyStrong" tone="secondary">
            {label}
          </Text>
        )}
      </PressableScale>
    );
  }

  const { colors } = theme;
  const look =
    variant === 'primary'
      ? { fill: colors.accent, edge: colors.accentEdge, stroke: undefined, label: colors.accentText }
      : variant === 'ink'
        ? { fill: colors.ink, edge: colors.inkEdge, stroke: undefined, label: colors.inkText }
        : {
            fill: colors.surface,
            edge: colors.borderStrong,
            stroke: colors.border,
            label: variant === 'danger' ? colors.danger : colors.textPrimary,
          };

  return (
    <BlockPressable
      onPress={onPress}
      disabled={blocked}
      haptic={haptic}
      accessibilityLabel={label}
      height={size === 'compact' ? 44 : 56}
      radius={size === 'compact' ? theme.radius.md : theme.radius.lg}
      fill={look.fill}
      edge={look.edge}
      stroke={look.stroke}
    >
      {loading ? (
        <ActivityIndicator color={look.label} />
      ) : (
        <Text variant="bodyStrong" style={{ paddingHorizontal: 20, color: look.label, fontFamily: font.bold }}>
          {label}
        </Text>
      )}
    </BlockPressable>
  );
}
