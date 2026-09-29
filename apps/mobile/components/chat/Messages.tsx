import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Icon } from '../Icon';
import { Mascot } from '../Mascot';
import { Text } from '../Text';
import { RichText } from './RichText';
import { ThinkingDots } from './TypingIndicator';

/**
 * The chat rows.
 *
 * The agent's replies are not bubbles. A reply is the content of the screen,
 * set like writing, full width. Only the user's messages sit in a bubble — a
 * flat brand-tinted one on the right, no stroke (an outlined bubble reads as a
 * disabled field).
 *
 * Blocky himself lives here now rather than floating above the list: a small
 * avatar sits on its own line above whichever reply is currently his newest —
 * never every one, just the latest, the way a person's face doesn't reappear
 * above every line they've ever said. `ThinkingRow` is the same shape while
 * one is on the way, so the avatar never has to jump from "above my last
 * reply" to "above nothing" and back while a request is in flight.
 *
 * Above, not beside: a reply's content can be a line of text, or that plus a
 * whole capability grid or a plan card underneath. Putting the avatar in a
 * row next to *that* — top-aligned or centred, either one — means it either
 * floats disconnected from the text, or lands beside whatever happens to be
 * vertically in the middle of a tall block, which can be a button that has
 * nothing to do with him. Its own line above has no such problem: it never
 * has to compete with the content for a vertical position at all.
 */

const ENTER = FadeInDown.duration(260);

/** How big Blocky is riding along a reply — present, not a footnote. */
const AVATAR_SIZE = 80;

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
  avatar = false,
  children,
}: {
  text: string;
  /** Why a request could not become a plan. The main content when there is no text. */
  note: string | null;
  /** True on Blocky's most recent reply in the thread, and nowhere else. */
  avatar?: boolean;
  /** A plan card, when the reply proposes a send. */
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const hasText = text.trim().length > 0;

  return (
    <Animated.View entering={ENTER} style={{ gap: theme.space.md }}>
      {avatar ? <Mascot pose="neutral" size={AVATAR_SIZE} idle /> : null}
      {hasText ? <RichText text={text} /> : null}
      {note ? <RichText text={note} tone={hasText ? 'secondary' : 'primary'} /> : null}
      {children}
    </Animated.View>
  );
}

/**
 * Blocky beside the dots while a reply is on the way.
 *
 * Unlike a real reply, this one's content is always exactly the same small,
 * fixed-height thing — never a chip grid, never a plan card — so a row and a
 * vertical centre can't land him beside something unrelated the way it could
 * for a reply. Nothing to solve here that the column above solves elsewhere.
 */
export function ThinkingRow({ label }: { label: string | null }) {
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      style={styles.thinkingRow}
    >
      <Mascot pose="neutral" size={AVATAR_SIZE} idle />
      <View style={styles.thinkingText}>
        {/* Keyed on the label so each new step fades in rather than snapping. */}
        <Animated.View key={label ?? 'thinking'} entering={FadeIn.duration(180)}>
          <Text variant="label" tone="secondary" numberOfLines={1}>
            {label ?? 'Thinking'}
          </Text>
        </Animated.View>
        <ThinkingDots />
      </View>
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
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thinkingText: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
