import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { font, useTheme } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  /** Shown under the field in the danger tone. */
  error?: string | null;
  /** Something to the right of the input, e.g. a Paste button. */
  accessory?: React.ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, accessory, style, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const border = error ? theme.colors.danger : focused ? theme.colors.accent : theme.colors.border;

  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>

      <View
        style={[
          styles.box,
          {
            backgroundColor: focused ? theme.colors.surface : theme.colors.surfaceMuted,
            borderRadius: theme.radius.lg,
            borderWidth: Math.max(theme.stroke, 2),
            borderColor: border,
          },
        ]}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={theme.colors.textTertiary}
          selectionColor={theme.colors.accent}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: theme.colors.textPrimary }, style]}
          {...rest}
        />
        {accessory}
      </View>

      {error ? (
        <View style={styles.error}>
          <Icon name="alert-circle-outline" size={16} tone="danger" />
          <Text variant="caption" tone="danger" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 54,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 16,
    paddingVertical: 12,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
