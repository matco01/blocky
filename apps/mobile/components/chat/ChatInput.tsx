import type { RefObject } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { font, useTheme } from '../../theme';
import { BlockPressable } from '../BlockPressable';
import { Icon } from '../Icon';

/**
 * The message box at the bottom of Home. Controlled from outside, so the
 * suggestions can pre-fill it ("Send $") and put the cursor there.
 */
export function ChatInput({
  value,
  onChangeText,
  onSend,
  busy,
  allowWhileBusy,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  /** Text that may still be sent mid-request — "reset the chat" is how you get out of a stuck one. */
  allowWhileBusy?: (text: string) => boolean;
  inputRef?: RefObject<TextInput | null>;
}) {
  const theme = useTheme();
  const canSend = value.trim().length > 0 && (!busy || (allowWhileBusy?.(value) ?? false));

  function submit() {
    if (!canSend) return;
    onSend(value);
    onChangeText('');
  }

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: theme.stroke,
          borderRadius: theme.radius.xl,
          paddingLeft: theme.space.lg,
        },
      ]}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder="Ask Blocky…"
        placeholderTextColor={theme.colors.textTertiary}
        selectionColor={theme.colors.accent}
        multiline
        maxLength={2000}
        style={[styles.input, { color: theme.colors.textPrimary }]}
        onSubmitEditing={submit}
        submitBehavior="submit"
        returnKeyType="send"
      />
      <BlockPressable
        onPress={submit}
        disabled={!canSend}
        accessibilityLabel="Send message"
        height={38}
        radius={theme.radius.md}
        fill={canSend ? theme.colors.accent : theme.colors.surfaceMuted}
        edge={canSend ? theme.colors.accentEdge : theme.colors.border}
        style={styles.send}
      >
        <Icon name="paper-plane" size={18} tone={canSend ? 'inverted' : 'tertiary'} />
      </BlockPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingRight: 8,
    paddingVertical: 8,
    minHeight: 56,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
    includeFontPadding: false,
  },
  send: {
    width: 42,
    marginLeft: 8,
  },
});
