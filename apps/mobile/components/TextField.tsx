import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  /** Shown under the field in the warning tone. */
  error?: string | null;
  /** Something to the right of the input, e.g. a Paste button. */
  accessory?: React.ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, accessory, style, ...rest },
  ref,
) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="label" tone="tertiary">
        {label}
      </Text>

      <View
        style={[
          styles.box,
          {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.md,
            borderColor: error ? theme.colors.danger : 'transparent',
          },
        ]}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={theme.colors.textTertiary}
          selectionColor={theme.colors.accent}
          style={[styles.input, { color: theme.colors.textPrimary }, style]}
          {...rest}
        />
        {accessory}
      </View>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
});
