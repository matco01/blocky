import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { RichText } from './RichText';

/**
 * The three kinds of chat row.
 *
 * The agent's replies are not bubbles. A reply is the content of the screen,
 * set like writing, full width. Only the user's messages sit in a bubble — a
 * flat brand-tinted one on the right, no stroke (an outlined bubble reads as a
 * disabled field).
 */

const ENTER = FadeInDown.duration(260);

export function UserMessage({ text }: { text: string }) {
  const theme = useTheme();

  return (
    <Animated.View entering={ENTER} style={styles.userRow}>
      <View style={[styles.userBubble, { backgroundColor: theme.colors.brandTint, borderRadius: 18 }]}>
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
        <Icon name="alert-circle-outline" size={16} tone="warning" />
        <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
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
    paddingLeft: 56,
  },
  userBubble: {
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
