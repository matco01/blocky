import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInput,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { displayUsd } from '@blocky/shared';
import { ActionButton } from '../ActionButton';
import { BalanceDisplay } from '../BalanceDisplay';
import { CapabilityChips } from '../chat/CapabilityChips';
import { ChatInput } from '../chat/ChatInput';
import { ChatPlanCard } from '../chat/ChatPlanCard';
import { AssistantMessage, ErrorMessage, ThinkingRow, UserMessage } from '../chat/Messages';
import { Icon } from '../Icon';
import { Mascot } from '../Mascot';
import { PageDots, type PageProps } from '../PageDots';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { ApiError, api } from '../../lib/api';
import { STARTER_CAPABILITIES, type Capability } from '../../lib/capabilities';
import { matchAppearanceCommand, resolveAppearance } from '../../lib/appearanceCommand';
import { useChat } from '../../lib/chat';
import { handOffPlan, useSentPlans } from '../../lib/handoff';
import { useKeyboardVisible } from '../../lib/keyboard';
import { isResetPhrase } from '../../lib/resetPhrase';
import { useTheme } from '../../theme';

type BalanceState =
  | { state: 'loading' }
  | { state: 'setting-up' }
  | { state: 'ready'; balance: string }
  | { state: 'error'; message: string; lastBalance: string | null };

/** How often the balance refreshes while Home is on screen, so incoming money shows up. */
const BALANCE_POLL_MS = 20_000;

/**
 * Home — the first page of the pager.
 *
 * The balance, three shortcuts, and the chat. The chat is the main surface:
 * anything more involved than a plain send is something you say, not
 * somewhere you navigate to. Account is one swipe to the left.
 *
 * Blocky has no chrome of his own above the chat any more — no floating
 * mascot bar, nothing that docks or shrinks as you scroll. He lives inside
 * the message list instead (see `Messages.tsx`), which is also what fixed a
 * real bug: a sibling that resizes itself above a ScrollView resizes that
 * ScrollView's own viewport, and doing that while someone is mid-scroll is
 * what made scrolling feel broken. Nothing here does that any more.
 */
export function HomePage({ page, onPageChange }: PageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [balance, setBalance] = useState<BalanceState>({ state: 'loading' });
  const lastBalance = useRef<string | null>(null);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const { messages, busy, send, retry, showCapabilities, reset, sayLocally } = useChat();
  const isSent = useSentPlans();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const typing = useKeyboardVisible();

  // Whether the user is at (or near) the bottom of the conversation right now.
  // A new message should only pull the view down when they were already
  // there — otherwise reading back through the conversation gets yanked back
  // to the bottom the moment a reply streams in.
  const atBottomRef = useRef(true);

  const submit = useCallback(
    (text: string) => {
      if (isResetPhrase(text)) {
        reset();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        return;
      }

      const appearance = matchAppearanceCommand(text);
      if (appearance) {
        const target = resolveAppearance(appearance, theme.appearance);
        const already = theme.appearance === target;

        atBottomRef.current = true;
        if (!already) theme.setAppearance(target);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        sayLocally(text.trim(), already ? `Already in ${target} mode.` : `Switched to ${target} mode.`);
        return;
      }

      // Sending is always "take me to the latest" — the same as any chat app.
      atBottomRef.current = true;
      send(text);
    },
    [send, reset, sayLocally, theme],
  );

  const pickCapability = useCallback(
    (capability: Capability) => {
      if (capability.action.kind === 'send') {
        submit(capability.action.text);
      } else if (capability.action.kind === 'prefill') {
        setDraft(capability.action.text);
        inputRef.current?.focus();
      } else {
        atBottomRef.current = true;
        showCapabilities();
      }
    },
    [submit, showCapabilities],
  );

  const fetchBalance = useCallback(async () => {
    try {
      const result = await api.balance();
      lastBalance.current = result.totalUsd;
      // Same number as last poll: keep the same state object, so nothing re-renders.
      setBalance((current) =>
        current.state === 'ready' && current.balance === result.totalUsd
          ? current
          : { state: 'ready', balance: result.totalUsd },
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wallet_not_ready') {
        setBalance({ state: 'setting-up' });
        return;
      }
      // Keep the last known number on screen. A spinner that never resolves, or
      // a zero, both say something false about the user's money.
      setBalance({
        state: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
        lastBalance: lastBalance.current,
      });
    }
  }, []);

  // Refresh whenever Home comes back into view — most importantly, after a send.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void fetchBalance();
      return () => setFocused(false);
    }, [fetchBalance]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  // Poll only while Home is actually on screen — not behind Account, another
  // route, or a backgrounded app — and faster while the wallet is being created.
  useEffect(() => {
    if (!focused || !appActive || page !== 0) return;
    const interval = balance.state === 'setting-up' ? 2000 : BALANCE_POLL_MS;
    const timer = setInterval(() => void fetchBalance(), interval);
    return () => clearInterval(timer);
  }, [focused, appActive, page, balance.state, fetchBalance]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    atBottomRef.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 40;
  }, []);

  const shown =
    balance.state === 'ready' ? balance.balance : balance.state === 'error' ? (balance.lastBalance ?? '0') : '0';
  const canTransact = balance.state === 'ready' || (balance.state === 'error' && balance.lastBalance !== null);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* --- Top: header, balance, shortcuts ------------------------------- */}
      <View
        style={[
          styles.top,
          { paddingTop: insets.top + theme.space.sm, paddingBottom: typing ? theme.space.sm : theme.space.lg },
        ]}
      >
        <View style={styles.header}>
          <Text variant="label" tone="brand" style={styles.wordmark}>
            Blocky
          </Text>
          <View style={styles.dots} pointerEvents="box-none">
            <PageDots page={page} onPageChange={onPageChange} />
          </View>
          {typing ? (
            // While typing the big balance is folded away; keep the number in view.
            <Animated.View entering={FadeIn.duration(180)}>
              <Text variant="bodyStrong" tone="secondary" tabular>
                {displayUsd(shown)}
              </Text>
            </Animated.View>
          ) : (
            <PressableScale onPress={() => onPageChange(1)} accessibilityLabel="Account" haptic="none" scaleTo={0.9}>
              <Icon name="person-circle-outline" size={26} tone="secondary" />
            </PressableScale>
          )}
        </View>

        {/* Folded away while typing, so the conversation gets the screen. */}
        {typing ? null : (
          <Animated.View entering={FadeIn.duration(220)} style={styles.topBody}>
            <BalanceDisplay
              totalUsd={shown}
              loading={balance.state === 'loading' || balance.state === 'setting-up'}
              onPress={() => void fetchBalance()}
            />

            {balance.state === 'setting-up' ? (
              <Text variant="caption" tone="tertiary" style={styles.center}>
                Setting up your wallet…
              </Text>
            ) : null}
            {balance.state === 'error' ? (
              <Text variant="caption" tone="warning" style={styles.center}>
                {balance.lastBalance === null ? balance.message : `${balance.message} Showing your last known balance.`}
              </Text>
            ) : null}

            <View style={[styles.actions, { gap: theme.space.sm, marginTop: theme.space.lg }]}>
              <ActionButton label="Receive" icon="arrow-down" disabled={!canTransact} onPress={() => router.push('/receive')} />
              <ActionButton label="Send" icon="arrow-up" disabled={!canTransact} onPress={() => router.push('/send')} />
              <ActionButton label="Portfolio" icon="pie-chart-outline" onPress={() => router.push('/portfolio')} />
            </View>
          </Animated.View>
        )}
      </View>

      {/* --- Chat ---------------------------------------------------------- */}
      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        // Wider gaps between turns than within them, so each exchange reads as a unit.
        contentContainerStyle={[styles.chatContent, { gap: theme.space.xl }]}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          if (atBottomRef.current) scrollRef.current?.scrollToEnd({ animated: true });
        }}
        // The visible area shrinks when the keyboard opens; keep the latest message
        // in view — but only if that's where the user already was.
        onLayout={() => {
          if (atBottomRef.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        {messages.length === 0 && !busy ? (
          <View style={{ gap: theme.space.lg }}>
            <View style={styles.greetingRow}>
              <Mascot pose="neutral" size={96} idle />
              <Text variant="bodyStrong">Hi! What do you want to do?</Text>
            </View>
            <CapabilityChips capabilities={STARTER_CAPABILITIES} onPick={pickCapability} />
          </View>
        ) : (
          <>
            {messages.map((message, index) => {
              switch (message.role) {
                case 'user':
                  return <UserMessage key={message.id} text={message.text} />;

                case 'error':
                  return <ErrorMessage key={message.id} text={message.text} onRetry={() => retry(message.id)} />;

                case 'assistant': {
                  const plan = message.plan;
                  // Blocky rides beside his newest reply only — the one still
                  // last in the whole thread, not every reply he's ever sent.
                  const isLatest = index === messages.length - 1;

                  return (
                    <AssistantMessage key={message.id} text={message.text} note={message.note} avatar={isLatest}>
                      {plan ? (
                        <ChatPlanCard
                          plan={plan}
                          decision={message.decision}
                          sent={isSent(plan.id)}
                          onApprove={(fast) => {
                            handOffPlan(plan);
                            router.push({
                              pathname: '/send',
                              params: { planId: plan.id, ...(fast ? { autosend: '1' } : {}) },
                            });
                          }}
                        />
                      ) : null}
                      {message.capabilities ? (
                        <CapabilityChips capabilities={message.capabilities} onPick={pickCapability} />
                      ) : null}
                    </AssistantMessage>
                  );
                }
              }
            })}
            {busy ? <ThinkingRow /> : null}
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.sm,
          // The navigation-bar inset only applies when the keyboard is down;
          // with it up, it is just a gap between the input and the keys.
          paddingBottom: typing ? theme.space.sm : insets.bottom + theme.space.sm,
        }}
      >
        <ChatInput
          value={draft}
          onChangeText={setDraft}
          onSend={submit}
          busy={busy}
          allowWhileBusy={isResetPhrase}
          inputRef={inputRef}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  top: {
    paddingHorizontal: 20,
    gap: 8,
  },
  topBody: {
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 32,
  },
  wordmark: {
    fontSize: 18,
    lineHeight: 24,
  },
  // Centred on the screen regardless of what sits either side of it.
  dots: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chat: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
});
