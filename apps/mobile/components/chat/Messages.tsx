import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Text } from '../Text';
import { RichText } from './RichText';

/**
 * The three kinds of chat row.
 *
 * The agent's replies are not bubbles. A reply is the content of the screen,
 * set like writing, full width. Only the user's messages sit in a bubble —
 * a quiet one, on the right — which keeps the conversation readable at a glance
 * without looking like a support widget.
 */

const ENTER = FadeInDown.duration(260);

export function UserMessage({ text }: { text: string }) {
  const theme = useTheme();

  return (
    <Animated.View entering={ENTER} style={styles.userRow}>
      <View
        style={[
          styles.userBubble,
          { backgroundColor: theme.colors.bubble, borderRadius: theme.radius.lg },
        ]}
      >
        <Text variant="body" selectable>
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}

export function AssistantMessage({
  text,
  note,
  children,
}: {
  text: string;
  /** Why a request could not become a plan. The main content when there is no text. */
  note: string | null;
  /** A plan card, when the reply proposes a send. */
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const hasText = text.trim().length > 0;

  return (
    <Animated.View entering={ENTER} style={{ gap: theme.space.md }}>
      {hasText ? <RichText text={text} /> : null}
      {note ? <RichText text={note} tone={hasText ? 'secondary' : 'primary'} /> : null}
      {children}
    </Animated.View>
  );
}

export function ErrorMessage({ text, onRetry }: { text: string; onRetry: () => void }) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={`${text} Tap to retry.`}
        style={[styles.error, { gap: theme.space.sm }]}
      >
        <View style={[styles.errorDot, { backgroundColor: theme.colors.warning }]} />
        <Text variant="caption" tone="secondary" style={styles.errorText}>
          {text}{' '}
          <Text variant="caption" tone="accent">
            Tap to retry
          </Text>
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingLeft: 48,
  },
  userBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  errorText: {
    flex: 1,
  },
});
