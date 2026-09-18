import type { RefObject } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../../theme';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

/**
 * The message box at the bottom of Home.
 *
 * Controlled from outside, so the suggestions can pre-fill it ("Send $") and
 * put the cursor there.
 */
export function ChatInput({
  value,
  onChangeText,
  onSend,
  busy,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  busy: boolean;
  inputRef?: RefObject<TextInput | null>;
}) {
  const theme = useTheme();
  const canSend = value.trim().length > 0 && !busy;

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
      <PressableScale
        onPress={submit}
        disabled={!canSend}
        accessibilityLabel="Send message"
        haptic="light"
        style={[
          styles.send,
          {
            backgroundColor: canSend ? theme.colors.accent : 'transparent',
            borderRadius: theme.radius.pill,
          },
        ]}
      >
        <Text variant="bodyStrong" tone={canSend ? 'inverted' : 'tertiary'}>
          ↑
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
  },
  send: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
